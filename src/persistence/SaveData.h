#pragma once

#include <QByteArray>
#include <QString>

#include "game/GameScene.h"
#include "game/GameState.h"

// Parsed into a candidate; never modifies a live scene or GameState.
struct LoadedSave
{
    GameState state;
    QString mapPath;
    GameScene::SceneSnapshot snapshot;
};

bool parseSavedGame(const QByteArray &json, LoadedSave &out, QString &error);
constexpr qint64 kMaxSaveBytes = 8 * 1024 * 1024;
