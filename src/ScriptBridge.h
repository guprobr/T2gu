#pragma once

#include <QObject>
#include <QString>
#include <QVariant>
#include <QVariantMap>

class GameScene;

// The `api` object every level script sees as a global (installed by
// ScriptEngine). Pure pass-through to GameScene - holds no game state of its
// own. Kept as its own QObject rather than putting Q_INVOKABLE methods
// directly on GameScene so the script-facing surface stays visibly separate
// from GameScene's own C++ API.
class ScriptBridge : public QObject
{
    Q_OBJECT

public:
    explicit ScriptBridge(GameScene *scene, QObject *parent = nullptr);

    // hp <= 0 (the default) means "use GameState::heroBaseMaxHp" - see
    // GameScene::scriptSpawnCharacter(). Every chapter's own
    // "lara_cyber" spawn call relies on this so her max HP can persist and
    // grow across level transitions/saves instead of being reset to a
    // hardcoded literal every chapter; a companion spawn always passes its
    // own explicit hp instead (its own fixed archetype toughness, not
    // something meant to progress the same way).
    Q_INVOKABLE void spawnCharacter(const QString &name, int col, int row, int hp = 0);
    Q_INVOKABLE void spawnEnemy(const QString &name, int col, int row, int hp = 40);
    // A non-hostile, non-controllable character to talk to - see onTalkTo.
    Q_INVOKABLE void spawnNpc(const QString &name, int col, int row);
    // Removes a previously-spawned NPC (e.g. once "recruited" into the
    // party via spawnCharacter, so they don't stand around twice).
    Q_INVOKABLE void despawnNpc(const QString &name);
    Q_INVOKABLE void spawnProp(const QString &name, int col, int row);
    // A world pickup (assets/items/items.json) - auto-collected when the
    // player walks near it. See onItemCollected.
    Q_INVOKABLE void spawnItem(const QString &itemId, int col, int row);
    Q_INVOKABLE void setTileset(const QString &relativePath);
    Q_INVOKABLE void setTile(const QString &tileName, int col, int row);
    // An invisible rectangular movement barrier (tile-based, `width`x`height`
    // tiles starting at col,row) gating a path behind a story beat - call
    // again with the same `id` and blocked=false to lift it later.
    Q_INVOKABLE void setBarrier(const QString &id, int col, int row, int width, int height, bool blocked);
    Q_INVOKABLE void giveControl(const QString &name);
    // Generic named story/quest state (number, string, or bool) - persists
    // across level transitions (see loadLevel), but local to the current
    // chapter (map file): a name set in one chapter's script reads back as
    // defaultValue in every other chapter's, even though the underlying
    // value is never actually deleted. Use setGlobalVar/getGlobalVar below
    // for the few things (companion recruitment, chapter counter) that must
    // read the same way from every chapter.
    Q_INVOKABLE void setVar(const QString &name, const QVariant &value);
    Q_INVOKABLE QVariant getVar(const QString &name, const QVariant &defaultValue = false) const;
    // Same storage as setVar/getVar, just without the per-chapter
    // namespacing - the same name reads back the same value from any
    // chapter's script.
    Q_INVOKABLE void setGlobalVar(const QString &name, const QVariant &value);
    Q_INVOKABLE QVariant getGlobalVar(const QString &name, const QVariant &defaultValue = false) const;
    // The persistent inventory - a simple id->count map. Also survives a
    // level transition.
    Q_INVOKABLE void giveItem(const QString &itemId, int count = 1);
    Q_INVOKABLE void removeItem(const QString &itemId, int count = 1);
    Q_INVOKABLE int getItemCount(const QString &itemId) const;
    Q_INVOKABLE bool hasItem(const QString &itemId) const;
    // Adds to the party's shared level/XP - killing an enemy or picking up
    // a keyItem already award this automatically with no script
    // involvement; this is for narrative-driven awards a script decides
    // on itself (e.g. rescuing someone). See docs/SCRIPTING.md.
    Q_INVOKABLE void giveExperience(int amount);
    Q_INVOKABLE void playSound(const QString &name);
    Q_INVOKABLE void playMusic(const QString &name, bool loop = true);
    Q_INVOKABLE void stopMusic();
    // Tears down the current scene and loads a new map - see
    // GameScene::scriptLoadLevel() for exactly what does and doesn't
    // survive the transition.
    Q_INVOKABLE void loadLevel(const QString &relativePath);

    // Descriptor objects only - see ScriptEngine::handleYield(). They don't
    // do anything themselves; only meaningful when `yield`-ed from a JS
    // generator function, which is how a script pauses itself:
    //   yield api.wait(2.0);
    //   yield api.say("lara_cyber", "Hello!");
    Q_INVOKABLE QVariantMap wait(double seconds) const;
    Q_INVOKABLE QVariantMap say(const QString &speaker, const QString &text) const;

private:
    GameScene *m_scene;
};
