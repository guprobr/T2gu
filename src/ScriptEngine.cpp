#include "ScriptEngine.h"

#include <QDebug>
#include <QFile>
#include <QScopedValueRollback>
#include <QTimer>

ScriptEngine::ScriptEngine(QObject *apiObject, QObject *parent)
    : QObject(parent)
{
    m_engine.installExtensions(QJSEngine::ConsoleExtension); // console.log for script authors

    const QJSValue apiVal = m_engine.newQObject(apiObject);
    // newQObject() defaults to JavaScriptOwnership (the JS GC may try to
    // delete apiObject) unless it already has a C++ QObject parent. It does
    // here (GameScene), but force it explicitly too - this object must
    // outlive the engine's GC, not the other way around.
    QJSEngine::setObjectOwnership(apiObject, QJSEngine::CppOwnership);
    m_engine.globalObject().setProperty(QStringLiteral("api"), apiVal);
}

bool ScriptEngine::loadFile(const QString &path, QString *errorOut)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot open %1").arg(path);
        return false;
    }

    QScopedValueRollback<bool> executing(m_executing, true);
    const QJSValue result = m_engine.evaluate(QString::fromUtf8(file.readAll()), path);
    if (result.isError()) {
        if (errorOut) {
            *errorOut = QStringLiteral("%1:%2: %3")
                            .arg(path, result.property(QStringLiteral("lineNumber")).toString(), result.toString());
        }
        return false;
    }
    return true;
}

void ScriptEngine::callEntryPoint(const QString &name, const QJSValueList &args)
{
    if (m_stopped)
        return;
    m_pendingCalls.enqueue(PendingCall{ name, args });
    runNextPendingCall();
}

void ScriptEngine::postEntryPoint(const QString &name, const QJSValueList &args)
{
    if (m_stopped)
        return;
    m_pendingCalls.enqueue(PendingCall{ name, args });
    if (m_dispatchScheduled)
        return;
    m_dispatchScheduled = true;
    QTimer::singleShot(0, this, [this] {
        m_dispatchScheduled = false;
        runNextPendingCall();
    });
}

void ScriptEngine::stop()
{
    m_stopped = true;
    m_pendingCalls.clear();
    if (!m_executing)
        finishEntryPoint();
}

void ScriptEngine::resume()
{
    if (m_stopped)
        return;
    m_suspended = false;
    QTimer::singleShot(0, this, [this] { runNextPendingCall(); });
}

void ScriptEngine::startEntryPoint(const QString &name, const QJSValueList &args)
{
    QScopedValueRollback<bool> executing(m_executing, true);
    const QJSValue fn = m_engine.globalObject().property(name);
    if (!fn.isCallable())
        return;

    QJSValue result = fn.call(args);
    if (result.isError()) {
        qWarning() << "script error in" << name << ":" << result.toString();
        emit scriptError(QStringLiteral("%1: %2").arg(name, result.toString()));
        return;
    }
    if (m_stopped)
        return;

    const QJSValue nextFn = result.property(QStringLiteral("next"));
    if (!nextFn.isCallable())
        return;

    m_activeIterator = result;
    m_nextFn = nextFn;
    driveIterator(QJSValue());
}

void ScriptEngine::finishEntryPoint()
{
    m_activeIterator = QJSValue();
    m_nextFn = QJSValue();
    m_state = State::Idle;
    m_waitRemaining = 0.0;
}

void ScriptEngine::runNextPendingCall()
{
    if (m_stopped || m_suspended || m_drainingCalls || m_executing)
        return;

    // Plain/missing handlers can finish synchronously. Drain iteratively,
    // rather than recursively growing the stack for a burst of events.
    QScopedValueRollback<bool> draining(m_drainingCalls, true);
    while (!m_stopped && !m_suspended && m_state == State::Idle && m_activeIterator.isUndefined()
           && !m_pendingCalls.isEmpty()) {
        const PendingCall next = m_pendingCalls.dequeue();
        startEntryPoint(next.name, next.args);
    }
}

void ScriptEngine::driveIterator(const QJSValue &resumeArg)
{
    QScopedValueRollback<bool> executing(m_executing, true);
    QJSValueList args;
    if (!resumeArg.isUndefined())
        args.append(resumeArg);

    const QJSValue step = m_nextFn.callWithInstance(m_activeIterator, args);
    if (m_stopped) {
        finishEntryPoint();
        return;
    }
    if (step.isError()) {
        qWarning() << "script error resuming coroutine:" << step.toString();
        emit scriptError(step.toString());
        finishEntryPoint();
        return;
    }

    if (step.property(QStringLiteral("done")).toBool()) {
        finishEntryPoint();
        return;
    }

    handleYield(step.property(QStringLiteral("value")));
    if (m_stopped)
        finishEntryPoint(); // a synchronous dialogue listener retired us
}

void ScriptEngine::handleYield(const QJSValue &yielded)
{
    const QString type = yielded.isObject() ? yielded.property(QStringLiteral("type")).toString() : QString();

    if (type == QStringLiteral("wait")) {
        m_waitRemaining = yielded.property(QStringLiteral("seconds")).toNumber();
        m_state = State::WaitingForTimer;
    } else if (type == QStringLiteral("say")) {
        m_state = State::WaitingForDialogue;
        emit dialogueRequested(yielded.property(QStringLiteral("speaker")).toString(),
                                yielded.property(QStringLiteral("text")).toString());
    } else {
        // Unrecognized (or a plain bare `yield;`) - treat as a one-frame
        // pause rather than an error, so a script can yield without a
        // descriptor just to spread work across ticks if it ever needs to.
        m_waitRemaining = 0.0;
        m_state = State::WaitingForTimer;
    }
}

void ScriptEngine::onTick(qreal dtSeconds)
{
    if (m_stopped || m_suspended || m_executing || m_state != State::WaitingForTimer)
        return;

    m_waitRemaining -= dtSeconds;
    if (m_waitRemaining <= 0.0) {
        m_state = State::Idle; // driveIterator() sets it again if another wait/say follows
        driveIterator(QJSValue());
        runNextPendingCall();
    }
}

void ScriptEngine::advance()
{
    if (m_stopped || m_suspended || m_executing || m_state != State::WaitingForDialogue)
        return;

    m_state = State::Idle;
    {
        // Signals can also synchronously invoke application callbacks.
        QScopedValueRollback<bool> executing(m_executing, true);
        emit dialogueEnded();
    }
    if (m_stopped) {
        finishEntryPoint();
        return;
    }
    driveIterator(QJSValue());
    runNextPendingCall();
}
