#pragma once

#include <QJSEngine>
#include <QJSValue>
#include <QObject>
#include <QQueue>
#include <QString>

// Owns the embedded JS engine and drives level scripts. A script is plain
// JS; the game-facing `api.*` surface (see ScriptBridge) is installed as a
// global object, not passed as a parameter, so scripts read naturally:
//
//   function* onLevelStart() {
//       api.spawnEnemy("orc", 10, 5);           // immediate, returns right away
//       yield api.wait(2.0);                     // pauses 2 real seconds
//       yield api.say("lara_cyber", "Hello!");   // pauses until advance() is called
//       api.setTileset("grass_dirt");
//   }
//
// A plain (non-generator) function works too - callEntryPoint() calls it,
// finds no iterator to drive, and it's already fully done. Only functions
// that need to pause (via a `wait`/`say` yield) need to be `function*`.
//
// Only one coroutine runs at a time. Calling callEntryPoint() while one is
// already active QUEUES the new call rather than dropping it (see
// m_pendingCalls) - it runs once the active one finishes. This used to
// silently drop the new call outright, back when the only two trigger
// points (onEnemyDefeated, onPlayerDied) couldn't realistically overlap
// with onLevelStart in practice. That stopped being true once the engine
// grew onTalkTo/onItemUsed/onItemCollected alongside a real
// `yield api.wait(...)` in onLevelStart itself: a kill, a pickup, or a
// conversation landing during that window used to just vanish, silently -
// no warning, no trace, and exactly the kind of thing that reads as "the
// quest is broken" days later with no clue why. Queuing instead means a
// real gameplay event that already happened is never simply discarded.
class ScriptEngine : public QObject
{
    Q_OBJECT

public:
    // apiObject is installed as the global `api` - GameScene owns it
    // (typically a ScriptBridge), so ownership is forced to stay with C++
    // rather than the JS engine's garbage collector (see .cpp for why that
    // matters).
    explicit ScriptEngine(QObject *apiObject, QObject *parent = nullptr);

    // Reads and evaluates a script file. Returns false and fills errorOut on
    // a read failure or JS syntax/eval error.
    bool loadFile(const QString &path, QString *errorOut = nullptr);

    // Looks up a global function by `name` and calls it with `args` (no-op,
    // not an error, if the script never defined it - entry points are all
    // optional). See class comment for the generator-vs-plain-function split.
    void callEntryPoint(const QString &name, const QJSValueList &args = {});

    // Counts down an active wait() and resumes the coroutine once it elapses.
    void onTick(qreal dtSeconds);

    // Resumes a coroutine currently paused on a say() yield - called by
    // GameScene::advanceDialogue() (see ScriptBridge::say()).
    void advance();

    bool isPausedOnDialogue() const { return m_state == State::WaitingForDialogue; }
    // True whenever any coroutine is running or paused (dialogue or a
    // wait()) - broader than isPausedOnDialogue(), which only covers one of
    // the two paused states. Useful for anything that needs to wait out an
    // entire script step rather than just a visible dialogue box.
    bool isBusy() const { return m_state != State::Idle; }

signals:
    void dialogueRequested(QString speaker, QString text);
    void dialogueEnded();

private:
    enum class State { Idle, WaitingForTimer, WaitingForDialogue };

    // One queued callEntryPoint() call, waiting for the currently-active
    // coroutine (if any) to finish - see m_pendingCalls.
    struct PendingCall
    {
        QString name;
        QJSValueList args;
    };

    // Looks up and invokes `name` unconditionally - the actual dispatch
    // logic callEntryPoint() uses when idle, factored out so
    // runNextPendingCall() can reuse it exactly rather than duplicating it.
    void startEntryPoint(const QString &name, const QJSValueList &args);
    // Common "this coroutine (or plain-function entry point) is done" path -
    // clears the iterator state, goes Idle, then immediately dequeues and
    // starts the next pending call if one is waiting.
    void finishEntryPoint();
    void runNextPendingCall();
    void driveIterator(const QJSValue &resumeArg);
    void handleYield(const QJSValue &yielded);

    QJSEngine m_engine;
    QJSValue m_activeIterator;
    QJSValue m_nextFn; // cached iterator.next - only valid while m_activeIterator is
    State m_state = State::Idle;
    qreal m_waitRemaining = 0.0;
    // See the class comment above - a callEntryPoint() that arrives while
    // m_state != Idle waits here instead of being dropped.
    QQueue<PendingCall> m_pendingCalls;
};
