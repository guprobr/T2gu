#include "scripting/ScriptBridge.h"

#include "game/GameScene.h"

ScriptBridge::ScriptBridge(GameScene *scene, QObject *parent)
    : QObject(parent)
    , m_scene(scene)
{
}

void ScriptBridge::spawnCharacter(const QString &name, int col, int row, int hp)
{
    m_scene->scriptSpawnCharacter(name, col, row, hp);
}

void ScriptBridge::spawnEnemy(const QString &name, int col, int row, int hp)
{
    m_scene->scriptSpawnEnemy(name, col, row, hp);
}

void ScriptBridge::spawnEnemyAtWorld(const QString &name, double worldX, double worldY, int hp)
{
    m_scene->scriptSpawnEnemyAtWorld(name, worldX, worldY, hp);
}

void ScriptBridge::spawnNpc(const QString &name, int col, int row)
{
    m_scene->scriptSpawnNpc(name, col, row);
}

void ScriptBridge::despawnNpc(const QString &name)
{
    m_scene->scriptDespawnNpc(name);
}

void ScriptBridge::spawnProp(const QString &name, int col, int row)
{
    m_scene->spawnPropAt(name, col, row);
}

void ScriptBridge::spawnItem(const QString &itemId, int col, int row)
{
    m_scene->scriptSpawnItem(itemId, col, row);
}

void ScriptBridge::spawnItemAtWorld(const QString &itemId, double worldX, double worldY)
{
    m_scene->scriptSpawnItemAtWorld(itemId, worldX, worldY);
}

void ScriptBridge::setTileset(const QString &relativePath)
{
    m_scene->scriptSetTileset(relativePath);
}

void ScriptBridge::setTile(const QString &tileName, int col, int row)
{
    m_scene->scriptSetTile(tileName, col, row);
}

void ScriptBridge::setBarrier(const QString &id, int col, int row, int width, int height, bool blocked)
{
    m_scene->scriptSetBarrier(id, col, row, width, height, blocked);
}

void ScriptBridge::giveControl(const QString &name)
{
    m_scene->scriptGiveControl(name);
}

void ScriptBridge::setVar(const QString &name, const QVariant &value)
{
    m_scene->scriptSetVar(name, value);
}

QVariant ScriptBridge::getVar(const QString &name, const QVariant &defaultValue) const
{
    return m_scene->scriptGetVar(name, defaultValue);
}

void ScriptBridge::setGlobalVar(const QString &name, const QVariant &value)
{
    m_scene->scriptSetGlobalVar(name, value);
}

QVariant ScriptBridge::getGlobalVar(const QString &name, const QVariant &defaultValue) const
{
    return m_scene->scriptGetGlobalVar(name, defaultValue);
}

void ScriptBridge::giveItem(const QString &itemId, int count)
{
    m_scene->scriptGiveItem(itemId, count);
}

void ScriptBridge::giveExperience(int amount)
{
    m_scene->scriptGiveExperience(amount);
}

void ScriptBridge::removeItem(const QString &itemId, int count)
{
    m_scene->scriptRemoveItem(itemId, count);
}

int ScriptBridge::getItemCount(const QString &itemId) const
{
    return m_scene->scriptGetItemCount(itemId);
}

bool ScriptBridge::hasItem(const QString &itemId) const
{
    return m_scene->scriptHasItem(itemId);
}

void ScriptBridge::playSound(const QString &name)
{
    m_scene->scriptPlaySound(name);
}

void ScriptBridge::playMusic(const QString &name, bool loop)
{
    m_scene->scriptPlayMusic(name, loop);
}

void ScriptBridge::stopMusic()
{
    m_scene->scriptStopMusic();
}

void ScriptBridge::loadLevel(const QString &relativePath)
{
    m_scene->scriptLoadLevel(relativePath);
}

QVariantMap ScriptBridge::wait(double seconds) const
{
    return { { QStringLiteral("type"), QStringLiteral("wait") }, { QStringLiteral("seconds"), seconds } };
}

QVariantMap ScriptBridge::say(const QString &speaker, const QString &text) const
{
    return {
        { QStringLiteral("type"), QStringLiteral("say") },
        { QStringLiteral("speaker"), speaker },
        { QStringLiteral("text"), text },
    };
}
