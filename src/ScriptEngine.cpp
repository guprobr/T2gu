#include "ScriptEngine.h"

#include <QDebug>
#include <QFile>

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
    if (m_state != State::Idle) {
        // Queued, not dropped - see the class comment and finishEntryPoint().
        m_pendingCalls.enqueue(PendingCall{ name, args });
        return;
    }
    startEntryPoint(name, args);
}

void ScriptEngine::startEntryPoint(const QString &name, const QJSValueList &args)
{
    const QJSValue fn = m_engine.globalObject().property(name);
    if (!fn.isCallable())
        return; // script doesn't define this entry point - optional, not an error

    QJSValue result = fn.call(args);
    if (result.isError()) {
        qWarning() << "script error in" << name << ":" << result.toString();
        runNextPendingCall();
        return;
    }

    const QJSValue nextFn = result.property(QStringLiteral("next"));
    if (!nextFn.isCallable()) {
        // A plain function, not a generator - already fully done. Still
        // worth draining the queue: nothing NEW could have been queued
        // during this synchronous call today, but a plain entry point is
        // just as much "a slot that just freed up" as a finished coroutine.
        runNextPendingCall();
        return;
    }

    m_activeIterator = result;
    m_nextFn = nextFn;
    driveIterator(QJSValue());
}

void ScriptEngine::finishEntryPoint()
{
    m_activeIterator = QJSValue();
    m_nextFn = QJSValue();
    m_state = State::Idle;
    runNextPendingCall();
}

void ScriptEngine::runNextPendingCall()
{
    if (m_pendingCalls.isEmpty())
        return;
    const PendingCall next = m_pendingCalls.dequeue();
    startEntryPoint(next.name, next.args);
}

void ScriptEngine::driveIterator(const QJSValue &resumeArg)
{
    QJSValueList args;
    if (!resumeArg.isUndefined())
        args.append(resumeArg);

    const QJSValue step = m_nextFn.callWithInstance(m_activeIterator, args);
    if (step.isError()) {
        qWarning() << "script error resuming coroutine:" << step.toString();
        finishEntryPoint();
        return;
    }

    if (step.property(QStringLiteral("done")).toBool()) {
        finishEntryPoint();
        return;
    }

    handleYield(step.property(QStringLiteral("value")));
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
    if (m_state != State::WaitingForTimer)
        return;

    m_waitRemaining -= dtSeconds;
    if (m_waitRemaining <= 0.0) {
        m_state = State::Idle; // driveIterator() sets it again if another wait/say follows
        driveIterator(QJSValue());
    }
}

void ScriptEngine::advance()
{
    if (m_state != State::WaitingForDialogue)
        return;

    m_state = State::Idle;
    emit dialogueEnded();
    driveIterator(QJSValue());
}
