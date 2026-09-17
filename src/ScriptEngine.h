#pragma once

#include <QJSEngine>
#include <QJSValue>
#include <QObject>
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
// already active drops the new call - acceptable given the only two
// current trigger points (onEnemyDefeated, onPlayerDied) can't realistically
// overlap with onLevelStart in practice for a v1.
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

    void driveIterator(const QJSValue &resumeArg);
    void handleYield(const QJSValue &yielded);

    QJSEngine m_engine;
    QJSValue m_activeIterator;
    QJSValue m_nextFn; // cached iterator.next - only valid while m_activeIterator is
    State m_state = State::Idle;
    qreal m_waitRemaining = 0.0;
};
