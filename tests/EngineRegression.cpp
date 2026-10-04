#include <QApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeyEvent>
#include <QPainter>
#include <QGraphicsRectItem>
#include <QStyleOptionGraphicsItem>
#include <QTemporaryDir>
#include <QTimer>
#include <QtEndian>

#include <functional>
#include <limits>
#include <utility>

#include "GameScene.h"
#include "FireballItem.h"
#include "LevelUpTextItem.h"
#include "LightingOverlayItem.h"
#include "SceneLayers.h"
#include "SaveData.h"
#include "DialogueBoxWidget.h"
#include "DeathMenuWidget.h"
#include "InventoryWidget.h"
#include "LoadingOverlayWidget.h"
#include "MainWindow.h"
#include "Prop.h"
#include "ScriptEngine.h"
#include "TileMapItem.h"

namespace {
void check(bool condition, const char *message)
{
    if (!condition)
        qFatal("Regression failed: %s", message);
}

void writeFile(const QString &path, const QByteArray &data)
{
    QFile file(path);
    check(file.open(QIODevice::WriteOnly), "open fixture");
    check(file.write(data) == data.size(), "write fixture");
}

void writeJson(const QString &path, const QJsonObject &object)
{
    writeFile(path, QJsonDocument(object).toJson());
}

void waitUntil(const std::function<bool()> &done)
{
    QElapsedTimer deadline;
    deadline.start();
    while (!done() && deadline.elapsed() < 5000)
        QCoreApplication::processEvents(QEventLoop::AllEvents, 10);
    check(done(), "event-loop deadline");
}
}

// Inspect scheduling and path bookkeeping without adding game-facing APIs.
class EngineRegressionAccess
{
public:
    static int chapterSmoke(QApplication &app, const QString &mapPath);
    static void testPathRecovery(const QString &root);
    static void testMusicOwnership(const QString &root);
    static void testFailedLoads(const QString &root);
    static void testProjectileAndSelection(const QString &root);
    static void testRenderingAndDefeatPositions(const QString &root);
};

class ReentryApi : public QObject
{
    Q_OBJECT
public:
    ScriptEngine *engine = nullptr;
    QStringList trace;
    Q_INVOKABLE void mark(const QString &label)
    {
        check(engine->isBusy(), "ordinary and generator execution both report busy");
        trace.append(label);
    }
    Q_INVOKABLE void pump()
    {
        QTimer::singleShot(0, engine, [this] { engine->callEntryPoint("later"); });
        QCoreApplication::processEvents();
    }
    Q_INVOKABLE void tick() { engine->onTick(1.0); }
    Q_INVOKABLE void burst()
    {
        for (int i = 0; i < 10000; ++i)
            engine->callEntryPoint("missing");
        engine->callEntryPoint("later");
    }
    Q_INVOKABLE void retire() { engine->stop(); }
};

static void testScriptEngine(const QString &root)
{
    writeFile(root + "/engine.js", R"JS(
        function plain() { api.mark('start'); api.pump(); api.mark('end'); }
        function later() { api.mark('later'); }
        function burst() { api.burst(); }
        function retire() { api.mark('retire'); api.retire(); }
        function* timed() {
            api.mark('timer-start');
            yield {type:'wait', seconds:.01};
            api.mark('timer-resume'); api.pump(); api.tick();
            yield {type:'say', speaker:'test', text:'pause'};
            api.mark('timer-end');
        }
    )JS");
    ReentryApi api;
    ScriptEngine engine(&api);
    api.engine = &engine;
    QString error;
    check(engine.loadFile(root + "/engine.js", &error), "load engine regression script");
    engine.callEntryPoint("plain");
    check(api.trace == QStringList({"start", "end", "later"}), "plain call queues nested events");
    check(!engine.isBusy(), "plain queue drained");
    api.trace.clear();
    engine.postEntryPoint("missing");
    engine.postEntryPoint("later");
    check(engine.isBusy() && api.trace.isEmpty(), "posted events are pending before dispatch");
    waitUntil([&] { return !engine.isBusy(); });
    check(api.trace == QStringList({"later"}), "missing handler does not block posted events");
    api.trace.clear();
    engine.callEntryPoint("burst");
    check(api.trace == QStringList({"later"}) && !engine.isBusy(), "large queue drains without recursion");
    api.trace.clear();
    QObject::connect(&engine, &ScriptEngine::dialogueRequested, &engine, [&] { engine.advance(); });
    engine.callEntryPoint("timed");
    engine.postEntryPoint("later");
    engine.onTick(.02);
    check(engine.isPausedOnDialogue(), "nested advance cannot resume an executing generator");
    check(api.trace == QStringList({"timer-start", "timer-resume"}), "generator events wait for completion");
    engine.advance();
    check(api.trace == QStringList({"timer-start", "timer-resume", "timer-end", "later", "later"}),
          "generator queue preserves FIFO events");
    check(!engine.isBusy(), "generator queue drained");
    api.trace.clear();
    engine.postEntryPoint("retire");
    engine.postEntryPoint("later");
    waitUntil([&] { return !engine.isBusy(); });
    check(api.trace == QStringList({"retire"}), "retired engine discards stale queued events");

    for (bool stopOnRequest : {false, true}) {
        ReentryApi stoppedApi;
        ScriptEngine stoppedEngine(&stoppedApi);
        stoppedApi.engine = &stoppedEngine;
        check(stoppedEngine.loadFile(root + "/engine.js", &error), "load retirement fixture");
        if (stopOnRequest)
            QObject::connect(&stoppedEngine, &ScriptEngine::dialogueRequested, &stoppedEngine, [&] { stoppedEngine.stop(); });
        else
            QObject::connect(&stoppedEngine, &ScriptEngine::dialogueEnded, &stoppedEngine, [&] { stoppedEngine.stop(); });
        stoppedEngine.callEntryPoint("timed");
        stoppedEngine.onTick(.02);
        if (!stopOnRequest)
            stoppedEngine.advance();
        check(!stoppedEngine.isBusy(), "retirement inside dialogue signals clears the continuation");
    }
}

static void makeAssets(const QString &root)
{
    for (const QString dir : {"maps", "scripts", "characters", "props", "items", "tilesets", "audio/music", "audio/sfx"})
        check(QDir(root).mkpath(dir), "create fixture directory");
    QJsonObject stats;
    for (const QString name : {"hero", "enemy", "fresh", "restored", "window_hero", "window_companion", "window_enemy"}) {
        const QString dir = root + "/characters/" + name;
        check(QDir().mkpath(dir), "create character fixture");
        QImage image(64, 192, QImage::Format_ARGB32);
        image.fill(Qt::white);
        check(image.save(dir + "/" + name + ".png"), "save character fixture");
        QJsonArray rows;
        int row = 0;
        for (const QString action : {"idle", "walk", "attack", "hit", "die", "skill"})
            rows.append(QJsonObject{{"name", action}, {"index", row++}});
        writeJson(dir + "/" + name + ".json", {
            {"sheet", name + ".png"}, {"frameWidth", 32}, {"frameHeight", 32},
            {"framesPerFacing", 1}, {"frameDurationMs", 120}, {"rows", rows}});
        stats.insert(name, QJsonObject{{"str", 10}, {"int", 20}, {"spd", 10}});
    }
    writeJson(root + "/characters/stats.json", {{"stats", stats}});
    writeJson(root + "/characters/sounds.json", {{"sounds", QJsonObject{}}});
    writeJson(root + "/props/props.json", {{"props", QJsonObject{}}});
    QImage image(32, 32, QImage::Format_ARGB32);
    image.fill(Qt::white);
    check(image.save(root + "/items/token.png"), "save item fixture");
    writeJson(root + "/items/items.json", {{"items", QJsonObject{
        {"token", QJsonObject{{"name", "Token"}, {"image", "token"}, {"width", 32}}},
        {"shield", QJsonObject{{"name", "Shield"}, {"image", "token"}, {"width", 32},
             {"consumeOnUse", true}, {"onUse", QJsonObject{{"type", "permanentBoost"}, {"stat", "maxHp"}, {"amount", 10}}}}},
        {"speed_potion", QJsonObject{{"name", "Speed potion"}, {"image", "token"}, {"width", 32},
             {"consumeOnUse", true}, {"onUse", QJsonObject{{"type", "buff"}, {"stat", "speed"}, {"amount", 4}, {"durationSeconds", 30}}}}}
    }}});
    image = QImage(1280, 128, QImage::Format_ARGB32);
    image.fill(Qt::green);
    check(image.save(root + "/tilesets/ground.png"), "save tileset fixture");
    writeJson(root + "/tilesets/ground.json", {{"sheet", "ground.png"}, {"tileWidth", 128},
              {"tileHeight", 128}, {"columns", 10}, {"tiles", QJsonObject{{"ground", 0}, {"secondary", 9}}}});
    // A short valid PCM file prevents missing-file noise. QMediaPlayer
    // detects the content even for the engine's .ogg music filename.
    QByteArray wave = QByteArray::fromHex("52494646a40f000057415645666d74201000000001000100401f0000803e00000200100064617461800f0000");
    wave.append(QByteArray(3968, '\0'));
    QByteArray music = wave;
    music.append(QByteArray(480000 - 3968, '\0'));
    qToLittleEndian<quint32>(480036, music.data() + 4);
    qToLittleEndian<quint32>(480000, music.data() + 40);
    writeFile(root + "/audio/music/ambient.ogg", music);
    writeFile(root + "/audio/music/theme.ogg", music);
    writeFile(root + "/audio/music/short.ogg", wave);
    for (int i = 1; i <= 38; ++i)
        writeFile(root + QString("/audio/music/music%1.ogg").arg(i, 2, 10, QLatin1Char('0')), music);
    for (const QString sound : {"attack", "hit", "death", "select", "funeral_bell_4s"})
        writeFile(root + "/audio/sfx/" + sound + ".wav", wave);
}

static QString makeMap(const QString &root, const QString &name, const QByteArray &script)
{
    writeFile(root + "/scripts/" + name + ".js", script);
    QJsonArray base, objects;
    QJsonArray groundRow, objectRow;
    for (int x = 0; x < 10; ++x) {
        groundRow.append(0);
        objectRow.append(-1);
    }
    for (int y = 0; y < 10; ++y) {
        base.append(groundRow);
        objects.append(objectRow);
    }
    const QString path = root + "/maps/" + name + ".json";
    writeJson(path, {{"width", 10}, {"height", 10}, {"tileWidth", 128}, {"tileHeight", 128},
              {"tileset", "../tilesets/ground.json"}, {"script", "../scripts/" + name + ".js"},
              {"base", base}, {"obj", objects}});
    return path;
}

void EngineRegressionAccess::testPathRecovery(const QString &root)
{
    GameState state;
    GameScene scene(&state, makeMap(root, "paths", "function onLevelStart(){api.spawnCharacter('hero',1,1,100);}"));
    waitUntil([&] { return scene.isReady(); });
    scene.stopTicking();
    Character *hero = scene.controlledCharacter();
    const QPointF startFeet = hero->feetPos();
    const QPointF target(1100, startFeet.y());
    GameScene::PartyPath path;
    path.targetWorld = target;
    path.waypoints = {QPointF(700, startFeet.y()), target};
    path.repathCooldown = 10;
    // At 60 Hz, 320 px/s advances only 5.3 pixels per call. The old check
    // blacklisted this reachable waypoint after 0.8 seconds of progress.
    for (int i = 0; i < 120; ++i) {
        scene.moveAlongPath(hero, path, target, 320, 1.0 / 60);
        hero->tick(1.0 / 60);
    }
    check(scene.m_temporarilyBlockedCells.isEmpty(), "normal sub-threshold frame movement never blacklists a waypoint");
    check(hero->feetPos().x() > startFeet.x() + 600, "normal path steering makes uninterrupted progress");

    path = {};
    path.waypoints = {QPointF(1100, startFeet.y())};
    path.targetWorld = target;
    path.repathCooldown = 10;
    // Hold the character in place to represent real continuous-collision
    // failure while the coarse path still considers the waypoint open.
    for (int i = 0; i < 55; ++i)
        scene.moveAlongPath(hero, path, target, 320, 1.0 / 60);
    check(scene.m_temporarilyBlockedCells.contains(QPoint(8, 1)), "a genuinely stationary mover still triggers recovery");

    path = {};
    path.targetWorld = target;
    path.waypoints = {hero->feetPos(), target};
    path.lastWaypointDistance = 1;
    path.stuckTimer = .7;
    path.repathCooldown = 10;
    scene.moveAlongPath(hero, path, target, 320, .01);
    check(path.waypoints.size() == 1 && path.lastWaypointDistance < 0 && path.stuckTimer == 0,
          "consuming a waypoint resets the progress baseline");

    hero->setPos(hero->pos() + startFeet - hero->feetPos());
    scene.scriptSetBarrier("partition", 5, 0, 1, 10, true);
    scene.m_temporarilyBlockedCells.clear();
    path = {};
    scene.moveAlongPath(hero, path, target, 320, 1.0 / 60);
    check(path.waypoints.isEmpty() && path.repathCooldown > .7, "unreachable target starts a retry cooldown");
    for (int i = 0; i < 20; ++i)
        scene.moveAlongPath(hero, path, target, 320, 1.0 / 60);
    check(path.repathCooldown < .5 && path.repathCooldown > .4,
          "failed A* does not restart the cooldown and search every tick");
    scene.scriptSetBarrier("partition", 0, 0, 1, 1, false);
    for (int i = 0; i < 35; ++i)
        scene.moveAlongPath(hero, path, target, 320, 1.0 / 60);
    check(!path.waypoints.isEmpty(), "failed search retries after its cooldown and recovers when a gate opens");
}

void EngineRegressionAccess::testMusicOwnership(const QString &root)
{
    AudioManager audio;
    int completions = 0;
    QObject::connect(&audio, &AudioManager::musicFinished, &audio, [&] { ++completions; });
    audio.playMusic("ambient", false);
    audio.fadeOutMusic(2000);
    QPropertyAnimation *oldFade = audio.m_fadeAnimation;
    check(oldFade, "music fade starts for an active request");
    oldFade->setCurrentTime(1000);
    audio.stopMusic();
    check(!audio.m_fadeAnimation && !audio.m_musicActive && audio.m_musicOutput.volume() == 1,
          "explicit stop cancels the fade and restores gain");
    QMetaObject::invokeMethod(oldFade, "finished", Qt::DirectConnection);
    check(completions == 0, "cancelled fade cannot emit a later music completion");
    audio.fadeOutMusic(0);
    check(completions == 0 && !audio.m_fadeAnimation, "fading silence does not restart playback policy");

    audio.playMusic("ambient", false);
    audio.fadeOutMusic(2000);
    oldFade = audio.m_fadeAnimation;
    audio.playMusic("theme", true);
    const QUrl replacement = audio.m_musicPlayer.source();
    QMetaObject::invokeMethod(oldFade, "finished", Qt::DirectConnection);
    check(audio.m_musicActive && audio.m_musicPlayer.source() == replacement && completions == 0,
          "superseded fade cannot stop the replacement track");
    audio.fadeOutMusic(0);
    check(completions == 1 && !audio.m_musicActive && !audio.m_fadeAnimation,
          "current fade completes exactly once and clears its request");
    audio.stopMusic();
    audio.playMusic("short", false);
    waitUntil([&] { return completions == 2; });
    check(!audio.m_musicActive && !audio.m_fadeAnimation && audio.m_musicOutput.volume() == 1,
          "actual backend natural completion clears the music request exactly once");
    audio.playMusic("missing", false);
    waitUntil([&] { return audio.m_musicPlayer.error() != QMediaPlayer::NoError; });
    check(!audio.m_musicActive, "failed media clears its active request");
    audio.fadeOutMusic(0);
    check(completions == 2 && !audio.m_fadeAnimation, "media failure and its obsolete fade do not count as completion");

    // Exercise the owned intro deadline immediately instead of waiting two
    // minutes. Completion injection tests policy routing independently of
    // backend timing; the cancellation tests above exercise actual fades.
    for (int scenario = 0; scenario < 4; ++scenario) {
        GameState state;
        GameScene scene(&state, makeMap(root, QString("music%1").arg(scenario), "function onLevelStart(){}"));
        waitUntil([&] { return scene.isReady(); });
        check(scene.m_ambientIntroTimer.isActive(), "automatic intro owns a deadline");
        if (scenario == 0) {
            scene.m_ambientIntroTimer.setInterval(1);
            waitUntil([&] { return scene.m_audio.m_fadeAnimation != nullptr; });
            scene.m_audio.m_fadeAnimation->setCurrentTime(2000);
            check(!state.lastMusicTrack.isEmpty() && !scene.m_ambientIntroTimer.isActive(),
                  "intro deadline fades once and hands off to the playlist");
        } else if (scenario == 1) {
            scene.m_audio.musicFinished();
            const QString first = state.lastMusicTrack;
            check(!first.isEmpty() && !scene.m_ambientIntroTimer.isActive(), "early natural end cancels the intro deadline");
            QMetaObject::invokeMethod(&scene.m_ambientIntroTimer, "timeout", Qt::DirectConnection);
            check(!scene.m_audio.m_fadeAnimation, "obsolete intro timeout cannot fade a playlist track");
            scene.m_audio.musicFinished();
            check(state.lastMusicTrack != first, "automatic completion advances the playlist without an immediate repeat");
        } else {
            scene.m_audio.fadeOutMusic(2000);
            oldFade = scene.m_audio.m_fadeAnimation;
            if (scenario == 2)
                scene.scriptStopMusic();
            else
                scene.scriptPlayMusic("theme", false);
            const QUrl source = scene.m_audio.m_musicPlayer.source();
            scene.m_audio.musicFinished();
            QMetaObject::invokeMethod(oldFade, "finished", Qt::DirectConnection);
            QMetaObject::invokeMethod(&scene.m_ambientIntroTimer, "timeout", Qt::DirectConnection);
            check(!scene.m_automaticMusic && !scene.m_ambientIntroTimer.isActive()
                      && !scene.m_audio.m_fadeAnimation && state.lastMusicTrack.isEmpty()
                      && scene.m_audio.m_musicPlayer.source() == source,
                  "script music and silence survive stale intro, completion and fade callbacks");
            check(scene.m_audio.m_musicActive == (scenario == 3), "script silence and explicit track retain their intended ownership");
        }
        scene.stopTicking();
        scene.m_audio.musicFinished();
        check(!scene.m_audio.m_musicActive && !scene.m_ambientIntroTimer.isActive(), "retired scenes cannot resume automatic music");
    }
}

static void testMalformedMaps(const QString &root)
{
    const QString validPath = makeMap(root, "map_validation", "function onLevelStart(){}");
    QFile file(validPath);
    check(file.open(QIODevice::ReadOnly), "read map validation fixture");
    const QJsonObject valid = QJsonDocument::fromJson(file.readAll()).object();
    file.close();
    TileMap map;
    QString error;
    check(map.load(validPath, &error), "valid map loads before rejected replacements");
    const quint64 revision = map.tilesetRevision();
    QVector<QJsonObject> malformed;
    for (const QString key : {"width", "height", "tileWidth", "tileHeight"}) {
        for (const QJsonValue &value : {QJsonValue(0), QJsonValue(-1), QJsonValue(1.5), QJsonValue(4097), QJsonValue("10")}) {
            auto candidate = valid;
            candidate.insert(key, value);
            malformed.append(candidate);
        }
    }
    auto candidate = valid;
    candidate.insert("width", 4096);
    candidate.insert("height", 4096);
    malformed.append(candidate);
    candidate = valid;
    candidate.insert("tileset", "missing.json");
    malformed.append(candidate);
    for (const QString layer : {"base", "obj"}) {
        candidate = valid;
        candidate.insert(layer, "wrong-type");
        malformed.append(candidate);
        candidate = valid;
        auto rows = valid.value(layer).toArray();
        rows.removeLast();
        candidate.insert(layer, rows);
        malformed.append(candidate);
        for (const QJsonValue &index : {QJsonValue(-2), QJsonValue(10), QJsonValue(0.5), QJsonValue("0"), QJsonValue(QJsonValue::Null)}) {
            candidate = valid;
            rows = valid.value(layer).toArray();
            auto row = rows[0].toArray();
            row[0] = index;
            rows[0] = row;
            candidate.insert(layer, rows);
            malformed.append(candidate);
        }
        candidate = valid;
        rows = valid.value(layer).toArray();
        rows[0] = QJsonArray{0};
        candidate.insert(layer, rows);
        malformed.append(candidate);
    }
    for (const auto &bad : malformed) {
        writeJson(root + "/maps/malformed.json", bad);
        error.clear();
        check(!map.load(root + "/maps/malformed.json", &error) && !error.isEmpty(), "malformed map rejected with a useful error");
        check(map.widthInTiles() == 10 && map.heightInTiles() == 10 && map.tileWidth() == 128
                  && map.baseAt(0, 0) == 0 && map.objAt(0, 0) == -1
                  && map.tilesetRevision() == revision && map.isWalkable(64, 64),
              "failed map load retains complete prior dimensions, grids, sheet and revision");
        TileMap empty;
        check(!empty.load(root + "/maps/malformed.json", &error) && empty.widthInTiles() == 0
                  && empty.baseAt(0, 0) == -1 && !empty.isWalkable(64, 64), "initial malformed load leaves a safe empty map");
    }
    writeFile(root + "/maps/malformed.json", "[]");
    check(!map.load(root + "/maps/malformed.json", &error), "non-object map root rejected");
    candidate = valid;
    candidate.remove("tileWidth");
    candidate.remove("tileHeight");
    candidate.remove("obj");
    writeJson(root + "/maps/defaults.json", candidate);
    check(map.load(root + "/maps/defaults.json", &error) && map.tileWidth() == 128 && map.objAt(0, 0) == -1,
          "omitted spacing and object layer retain compatible defaults");
    map.setBaseTile(0, 0, 10);
    check(map.baseAt(0, 0) == 0, "runtime tile edit rejects nonexistent artwork indices");
    check(map.tileSheet().tile(10).isNull(), "out-of-range tile lookup stays empty");
    map.setBaseTile(0, 0, 9);
    QImage tiny(32, 32, QImage::Format_ARGB32);
    tiny.fill(Qt::green);
    check(tiny.save(root + "/tilesets/tiny.png"), "save small replacement tileset");
    writeJson(root + "/tilesets/tiny.json", {{"sheet", "tiny.png"}, {"tileWidth", 32},
              {"tileHeight", 32}, {"columns", 1}, {"tiles", QJsonObject{{"ground", 0}}}});
    const quint64 beforeSwap = map.tilesetRevision();
    check(!map.loadTileset("../tilesets/tiny.json", &error) && map.baseAt(0, 0) == 9
              && map.tileSheet().tileCount() == 10 && map.tilesetRevision() == beforeSwap,
          "smaller valid sheet cannot discard artwork referenced by the current grids");
    QFile oversized(root + "/maps/oversized.json");
    check(oversized.open(QIODevice::WriteOnly) && oversized.resize(32 * 1024 * 1024 + 1), "create oversized sparse map fixture");
    oversized.close();
    check(!map.load(oversized.fileName(), &error) && error.contains("32 MiB") && map.baseAt(0, 0) == 9,
          "oversized map file is rejected before parsing or replacing live data");
}

static void testSaveValidation(const QString &root)
{
    makeMap(root, "save_validation", "function onLevelStart(){api.spawnCharacter('hero',1,1,100);}");
    const QJsonObject actor{{"name", "hero"}, {"x", -15}, {"y", -25}, {"hp", 80}, {"maxHp", 100}};
    const QJsonObject scene{{"party", QJsonArray{actor}}, {"controlledName", "hero"}};
    const QJsonObject valid{{"saveVersion", 2}, {"map", "save_validation.json"}, {"scene", scene}};
    LoadedSave saved;
    QString error;
    check(parseSavedGame(QJsonDocument(valid).toJson(), saved, error), "version 2 defaults and negative padded coordinates are valid");
    check(saved.state.level == 1 && saved.state.heroBaseMaxHp == 200 && saved.snapshot.party[0].x == -15
              && saved.snapshot.party[0].temporaryBuffs.speed == 0, "older saves retain defaults and exact raw coordinates");
    QVector<QJsonObject> malformed;
    for (const QString key : {"level", "experience", "itemBonusStrength", "itemBonusIntelligence", "itemBonusMaxHp", "heroBaseMaxHp"}) {
        for (const QJsonValue &value : {QJsonValue(-1), QJsonValue(1.5), QJsonValue("1"), QJsonValue(2147483647)}) {
            auto bad = valid; bad.insert(key, value); malformed.append(bad);
        }
    }
    for (const QJsonValue &version : {QJsonValue(1), QJsonValue(3), QJsonValue(2.5), QJsonValue("2")}) {
        auto bad = valid; bad.insert("saveVersion", version); malformed.append(bad);
    }
    for (const QString key : {"vars", "inventory", "scene"}) {
        auto bad = valid; bad.insert(key, QJsonArray{}); malformed.append(bad);
    }
    for (const QJsonValue &value : {QJsonValue(QJsonArray{}), QJsonValue(QJsonObject{}), QJsonValue(QJsonValue::Null)}) {
        auto bad = valid; bad.insert("vars", QJsonObject{{"flag", value}}); malformed.append(bad);
    }
    for (const QJsonValue &value : {QJsonValue(-1), QJsonValue(1.5), QJsonValue("2"), QJsonValue(2147483647)}) {
        auto bad = valid; bad.insert("inventory", QJsonObject{{"token", value}}); malformed.append(bad);
    }
    auto bad = valid; bad.insert("inventory", QJsonObject{{"missing", 1}}); malformed.append(bad);
    for (const QString &filename : {QString("../maps/save_validation.json"), QString("missing.json"), QString(""), QString("/absolute.json")}) {
        bad = valid; bad.insert("map", filename); malformed.append(bad);
    }
    for (const QString key : {"party", "enemies", "npcs", "items"}) {
        bad = valid; auto content = scene; content.insert(key, "wrong-type"); bad.insert("scene", content); malformed.append(bad);
    }
    for (const QString key : {"x", "y", "hp", "maxHp", "name"}) {
        auto content = scene; auto invalidActor = actor; invalidActor.insert(key, "invalid");
        content.insert("party", QJsonArray{invalidActor}); bad = valid; bad.insert("scene", content); malformed.append(bad);
    }
    for (const QJsonObject &fields : {QJsonObject{{"x", -17}}, QJsonObject{{"y", -1000}}, QJsonObject{{"x", 1280}},
         QJsonObject{{"hp", -1}}, QJsonObject{{"hp", 101}}, QJsonObject{{"maxHp", 0}}, QJsonObject{{"name", "missing_actor"}},
         QJsonObject{{"temporaryBuffs", QJsonArray{}}},
         QJsonObject{{"temporaryBuffs", QJsonObject{{"speed", 1}, {"speedRemaining", 0}}}},
         QJsonObject{{"temporaryBuffs", QJsonObject{{"strength", -1}, {"strengthRemaining", 1}}}},
         QJsonObject{{"temporaryBuffs", QJsonObject{{"intelligence", 1}, {"intelligenceRemaining", -1}}}}}) {
        auto invalidActor = actor;
        for (auto it = fields.begin(); it != fields.end(); ++it) invalidActor.insert(it.key(), it.value());
        auto content = scene; content.insert("party", QJsonArray{invalidActor}); bad = valid; bad.insert("scene", content); malformed.append(bad);
    }
    for (const QString name : {"missing_actor", "enemy", ""}) {
        auto content = scene; content.insert("controlledName", name); bad = valid; bad.insert("scene", content); malformed.append(bad);
    }
    auto content = scene; content.insert("party", QJsonArray{actor, actor}); bad = valid; bad.insert("scene", content); malformed.append(bad);
    content = scene; auto dead = actor; dead.insert("hp", 0); content.insert("party", QJsonArray{dead}); bad = valid; bad.insert("scene", content); malformed.append(bad);
    for (const QJsonObject &item : {QJsonObject{{"itemId", "missing"}, {"x", 10}, {"y", 10}},
         QJsonObject{{"itemId", "token"}, {"x", -1}, {"y", 10}}, QJsonObject{{"itemId", "token"}, {"x", 1280}, {"y", 10}}}) {
        content = scene; content.insert("items", QJsonArray{item}); bad = valid; bad.insert("scene", content); malformed.append(bad);
    }
    for (const auto &rootJson : malformed) {
        saved.state.vars.insert("sentinel", true);
        saved.snapshot.controlledName = "sentinel";
        error.clear();
        check(!parseSavedGame(QJsonDocument(rootJson).toJson(), saved, error) && !error.isEmpty(), "malformed save rejected with a clear reason");
        check(saved.state.vars.value("sentinel").toBool() && saved.snapshot.controlledName == "sentinel",
              "failed parsing never modifies the supplied state or snapshot");
    }
    check(!parseSavedGame("[]", saved, error) && !parseSavedGame("{", saved, error), "wrong root and corrupt JSON rejected");
    check(!parseSavedGame(QByteArray(kMaxSaveBytes + 1, ' '), saved, error), "oversized save rejected before parsing");
    bad = valid;
    bad.remove("map"); bad.insert("mapPath", root + "/maps/save_validation.json");
    check(parseSavedGame(QJsonDocument(bad).toJson(), saved, error), "read-only legacy mapPath remains compatible");
    auto enemy = actor; enemy.insert("name", "enemy");
    content = scene; content.insert("enemies", QJsonArray{enemy, enemy});
    bad = valid; bad.insert("scene", content);
    check(parseSavedGame(QJsonDocument(bad).toJson(), saved, error) && saved.snapshot.enemies.size() == 2,
          "repeated enemy archetypes remain valid");
    content.insert("npcs", QJsonArray{enemy}); bad.insert("scene", content);
    check(!parseSavedGame(QJsonDocument(bad).toJson(), saved, error), "combat-health NPC snapshot is invalid");
}

void EngineRegressionAccess::testFailedLoads(const QString &root)
{
    const QString path = makeMap(root, "safe_load", R"JS(
        function onLevelStart() {
            api.spawnCharacter('window_hero', 3, 3, 100);
            api.spawnItem('token', 6, 6);
            if (!api.getVar('booted', false)) { api.giveItem('token', 2); api.setVar('booted', true); }
            api.setGlobalVar('marker', 'keeper');
        }
        function* hold() { yield api.wait(10); api.setGlobalVar('resumed', true); }
        function after() { api.setGlobalVar('queued', true); }
    )JS");
    qputenv("T2GU_MAP_PATH", path.toLocal8Bit());
    qputenv("T2GU_SAVE_DIR", (root + "/load_saves").toLocal8Bit());
    MainWindow window;
    window.show();
    waitUntil([&] { return window.m_scene && window.m_scene->isReady() && !window.m_levelTransitionPending; });
    window.saveGame();
    const QString savePath = root + "/load_saves/save.json";
    QFile file(savePath);
    check(file.open(QIODevice::ReadOnly), "write actual save for load-failure tests");
    const QJsonObject valid = QJsonDocument::fromJson(file.readAll()).object();
    file.close();
    GameScene *old = window.m_scene;
    Character *hero = old->controlledCharacter();
    const QPointF position = hero->pos();
    auto sameGame = [&] {
        check(window.m_scene == old && window.m_view->scene() == old && old->controlledCharacter() == hero,
              "load failure retains the original scene, view and character pointers");
        check(hero->pos() == position && window.m_gameState.vars.value("marker") == "keeper"
                  && window.m_gameState.inventory.value("token") == 2 && !window.m_gameState.vars.contains("poison"),
              "load failure retains positions, inventory and story state");
        check(!window.m_levelTransitionPending && !window.m_loadingOverlay->isVisible() && old->m_tickTimer.isActive(),
              "load failure clears the overlay and resumes simulation");
    };
    // Semantic failures never even start a scene transition.
    for (const QString key : {"level", "experience", "heroBaseMaxHp"}) {
        auto invalid = valid; invalid.insert(key, -1); writeJson(savePath, invalid);
        window.loadGame(); sameGame();
    }
    old->showInfoMessage("Old", "Keep this dialogue");
    old->m_scriptEngine.callEntryPoint("hold");
    old->m_scriptEngine.postEntryPoint("after");
    hero->applyTemporarySpeedBuff(4, 2);
    window.loadLevel(root + "/maps/missing_map.json");
    check(old->m_simulationPaused && !old->m_tickTimer.isActive(), "transition immediately suspends old ticks");
    QCoreApplication::processEvents();
    check(!window.m_gameState.vars.contains("queued"), "posted old script events cannot drain during preparation");
    waitUntil([&] { return !window.m_levelTransitionPending; });
    sameGame();
    check(window.m_dialogueBox->isVisible() && old->isDialogueActive(), "failure retains the old modal dialogue");
    check(hero->temporaryBuffs().speedRemaining > 1.9, "loading time does not advance old buff timers");
    check(old->isScriptBusy(), "failure retains the waiting coroutine and queued calls");
    old->m_scriptEngine.onTick(10);
    check(window.m_gameState.vars.value("resumed").toBool() && window.m_gameState.vars.value("queued").toBool(),
          "restored coroutine and queued event continue normally after failure");
    old->advanceDialogue();

    QVector<QString> failedPaths;
    const QString badMap = makeMap(root, "bad_dimensions", "function onLevelStart(){}");
    QFile mapFile(badMap); check(mapFile.open(QIODevice::ReadOnly), "read bad map fixture");
    auto mapJson = QJsonDocument::fromJson(mapFile.readAll()).object(); mapFile.close();
    mapJson.insert("tileWidth", 0); writeJson(badMap, mapJson); failedPaths.append(badMap);
    const QString badDependency = makeMap(root, "bad_dependency", "function onLevelStart(){}");
    mapJson.insert("tileWidth", 128); mapJson.insert("tileset", "missing.json"); writeJson(badDependency, mapJson); failedPaths.append(badDependency);
    failedPaths.append(makeMap(root, "bad_syntax", "function onLevelStart( {"));
    failedPaths.append(makeMap(root, "bad_character", "function onLevelStart(){api.spawnCharacter('missing_actor',3,3,100);}"));
    failedPaths.append(makeMap(root, "bad_runtime", "function onLevelStart(){api.setGlobalVar('poison',true);throw Error('fixture failure');}"));
    failedPaths.append(makeMap(root, "bad_generator", "function* onLevelStart(){api.setGlobalVar('poison',true);throw Error('fixture failure');}"));
    for (const QString &failure : failedPaths) {
        window.loadLevel(failure);
        waitUntil([&] { return !window.m_levelTransitionPending; });
        sameGame();
    }
    // Structurally valid saves can still disagree with the party a chapter
    // reconstructs. Reject the candidate rather than silently skipping it.
    auto invalid = valid;
    auto snapshot = valid.value("scene").toObject();
    auto party = snapshot.value("party").toArray();
    auto actor = party[0].toObject(); actor.insert("name", "fresh"); party[0] = actor;
    snapshot.insert("party", party); snapshot.insert("controlledName", "fresh");
    invalid.insert("scene", snapshot); writeJson(savePath, invalid);
    window.loadGame();
    check(window.m_levelTransitionPending, "party disagreement reaches candidate restoration after valid parsing");
    waitUntil([&] { return !window.m_levelTransitionPending; }); sameGame();
    invalid = valid; snapshot = valid.value("scene").toObject();
    party = snapshot.value("party").toArray(); actor = party[0].toObject();
    actor.insert("maxHp", 101); party[0] = actor; snapshot.insert("party", party);
    invalid.insert("scene", snapshot); writeJson(savePath, invalid);
    window.loadGame();
    check(window.m_levelTransitionPending, "maximum-health inconsistency reaches candidate restoration");
    waitUntil([&] { return !window.m_levelTransitionPending; }); sameGame();
    // A restoration dependency can disappear after parsing. Roll back even
    // after partial candidate restoration has already repositioned actors.
    writeJson(savePath, valid);
    check(QFile::rename(root + "/items/token.png", root + "/items/token-hidden.png"), "hide restoration dependency");
    window.loadGame();
    check(window.m_levelTransitionPending, "missing item visual reaches restoration");
    waitUntil([&] { return !window.m_levelTransitionPending; }); sameGame();
    check(QFile::rename(root + "/items/token-hidden.png", root + "/items/token.png"), "restore visual dependency");
    window.loadGame();
    waitUntil([&] { return !window.m_levelTransitionPending; });
    check(window.m_scene != old && window.m_gameState.inventory.value("token") == 2
              && window.m_scene->captureSnapshot().items.size() == 1, "valid quickload succeeds after repeated failures");
    window.m_scene->scriptGiveItem("token", 1);
    check(window.m_gameState.inventory.value("token") == 3, "committed scene is rebound to the persistent live GameState");
    GameScene *beforeRespawn = window.m_scene;
    beforeRespawn->killControlledCharacter();
    check(window.m_deathMenuOpen, "death menu is active before a restart attempt");
    window.respawnFromBeginning();
    waitUntil([&] { return !window.m_levelTransitionPending; });
    check(window.m_scene == beforeRespawn && window.m_gameState.inventory.value("token") == 3
              && window.m_deathMenuOpen && window.m_deathMenuWidget->isVisible(),
          "failed full restart retains the old state and death menu");
    window.m_scene->stopTicking();
    // Initial boot has no previous scene; report failure without starting
    // an empty scene or leaving the loading overlay stuck indefinitely.
    qputenv("T2GU_MAP_PATH", (root + "/maps/missing_initial.json").toLocal8Bit());
    MainWindow initial;
    initial.show();
    waitUntil([&] { return !initial.m_levelTransitionPending; });
    check(!initial.m_scene && !initial.m_loadingScene && !initial.m_loadingOverlay->isVisible(), "failed initial boot remains safe and responsive");
    initial.loadLevel(path);
    waitUntil([&] { return initial.m_scene && !initial.m_levelTransitionPending; });
    check(initial.m_scene->isReady(), "failed initial boot can retry a valid map");
    const QString redirect = makeMap(root, "failed_redirect",
        "function onLevelStart(){api.spawnCharacter('window_hero',3,3,100);api.loadLevel('missing_destination.json');}");
    initial.loadLevel(redirect);
    waitUntil([&] { return initial.m_currentMapPath == redirect && !initial.m_levelTransitionPending; });
    check(initial.m_scene->isReady() && initial.m_scene->m_tickTimer.isActive() && initial.m_scene->m_clock.isValid(),
          "failed first-step redirect resumes a scene whose simulation clock had not started yet");
    initial.m_scene->stopTicking();
    qunsetenv("T2GU_MAP_PATH"); qunsetenv("T2GU_SAVE_DIR");
}

static void testLoading(const QString &root, bool generator)
{
    const QByteArray declaration = generator ? "function*" : "function";
    const QByteArray script = declaration + R"JS( onLevelStart() {
        api.setVar('inside_start', true);
        api.spawnCharacter('hero', 3, 3, 100);
        api.spawnItem('token', 3, 3);
        const start = Date.now(); while (Date.now() - start < 35) {}
        api.spawnCharacter('fresh', 4, 3, 100);
        api.setVar('inside_start', false);
        api.setVar('populated', true);
    )JS" + (generator ? "yield {type:'wait', seconds:.01};" : "") + R"JS( }
        function onItemCollected() {
            api.setVar('nested_pickup', api.getVar('inside_start', false));
            api.setVar('picked', true);
        }
    )JS";
    const QString path = makeMap(root, generator ? "loading_generator" : "loading_plain", script);
    GameState state;
    GameScene scene(&state, path);
    int ticks = 0, readyCount = 0;
    QObject::connect(&scene, &GameScene::controlledCharacterMoved, &scene, [&] { ++ticks; });
    QObject::connect(&scene, &GameScene::sceneReady, &scene, [&] {
        ++readyCount;
        check(scene.isReady() && scene.scriptGetVar("populated", false).toBool(), "ready follows population");
        check(ticks == 0 && scene.captureSnapshot().party.size() == 2, "no simulation during population");
        // Force event processing and a cold decode inside the readiness
        // consumer too, as snapshot restoration can do in MainWindow.
        scene.scriptSpawnEnemy("restored", 8, 8, 100);
        QElapsedTimer delay;
        delay.start();
        while (delay.elapsed() < 35)
            QCoreApplication::processEvents();
        check(ticks == 0, "readiness consumer completes before simulation starts");
        auto snapshot = scene.captureSnapshot();
        snapshot.party[1].x += 256;
        snapshot.party[1].y += 128;
        scene.restoreSnapshot(snapshot);
        const auto actual = scene.captureSnapshot();
        check(actual.party[1].x == snapshot.party[1].x && actual.party[1].y == snapshot.party[1].y,
              "complete party exists for snapshot restoration");
    });
    waitUntil([&] { return scene.scriptGetVar("picked", false).toBool(); });
    check(readyCount == 1 && ticks > 0, "scene becomes ready once and simulation resumes");
    check(!scene.scriptGetVar("nested_pickup", false).toBool(), "pickup handler cannot reenter population");
    scene.stopTicking();
}

static void testCombat(const QString &root, bool fireball)
{
    const QString path = makeMap(root, fireball ? "fireball" : "melee", R"JS(
        function onLevelStart() {
            api.spawnCharacter('hero', 3, 3, 100);
            api.spawnEnemy('enemy', 4, 3, 1);
            api.spawnEnemy('enemy', 4, 2, 100);
        }
        function onEnemyDefeated() {
            api.setVar('defeats', api.getVar('defeats', 0) + 1);
            for (let i = 0; i < 100; ++i) api.spawnEnemy('enemy', 9, 9, 100);
        }
    )JS");
    GameState state;
    GameScene scene(&state, path);
    waitUntil([&] { return scene.isReady(); });
    if (fireball)
        scene.triggerPlayerFireball();
    else {
        scene.triggerPlayerAttack();
        check(scene.isScriptBusy() && !scene.scriptGetVar("defeats", 0).toInt(),
              "melee notification waits until attack iteration returns");
    }
    waitUntil([&] { return scene.scriptGetVar("defeats", 0).toInt() == 1; });
    check(scene.captureSnapshot().enemies.size() == 101, "phase-spawn callback completes without invalidating combat");
    scene.stopTicking();
}

static void testDeath(const QString &root)
{
    const QString path = makeMap(root, "death", R"JS(
        function onLevelStart() {
            api.spawnCharacter('hero', 3, 3, 1);
            api.spawnEnemy('enemy', 3, 3, 100);
        }
        function onPlayerDied() {
            api.setVar('deaths', api.getVar('deaths', 0) + 1);
            for (let i = 0; i < 100; ++i) api.spawnEnemy('enemy', 9, 9, 100);
        }
    )JS");
    GameState state;
    GameScene scene(&state, path);
    int deaths = 0;
    QObject::connect(&scene, &GameScene::playerDied, &scene, [&] { ++deaths; });
    waitUntil([&] { return scene.scriptGetVar("deaths", 0).toInt() == 1; });
    check(deaths == 1 && scene.controlledCharacter()->isDead(), "controlled death fires once");
    check(scene.captureSnapshot().enemies.size() == 101, "death callback can safely spawn enemies");
    scene.stopTicking();
}

static void testFollowerCombat(const QString &root)
{
    const QString path = makeMap(root, "follower", R"JS(
        function onLevelStart() {
            api.spawnCharacter('hero', 3, 3, 100);
            api.spawnCharacter('fresh', 4, 3, 100);
            api.spawnEnemy('enemy', 4, 3, 1);
        }
        function onEnemyDefeated() {
            api.spawnCharacter('restored', 8, 8, 100);
            for (let i = 0; i < 100; ++i) api.spawnEnemy('enemy', 9, 9, 100);
            api.setVar('defeats', 1);
        }
    )JS");
    GameState state;
    GameScene scene(&state, path);
    waitUntil([&] { return scene.scriptGetVar("defeats", 0).toInt() == 1; });
    const auto snapshot = scene.captureSnapshot();
    check(snapshot.party.size() == 3 && snapshot.enemies.size() == 100,
          "follower kill handler can grow both party and enemy containers");
    scene.stopTicking();
}

static void testItemRestoration(const QString &root)
{
    const QString path = makeMap(root, "items", R"JS(
        function onLevelStart() {
            api.spawnCharacter('hero', 3, 3, 100);
            api.spawnItem('token', 6, 6);
            api.spawnItem('token', 6, 6);
            api.setBarrier('block_nudge', 7, 7, 1, 1, true);
            api.spawnItem('token', 6, 6);
        }
    )JS");
    GameState state;
    GameScene scene(&state, path);
    waitUntil([&] { return scene.isReady(); });
    scene.stopTicking();
    const auto saved = scene.captureSnapshot();
    check(saved.items.size() == 3, "duplicate item placements all exist");
    check(saved.items[0].x == 832 && saved.items[1].x == 880 && saved.items[2].x == 1072,
          "stored item anchors include nudges and skip blocked candidates");
    auto assertAnchors = [&] (GameScene &target) {
        const auto actual = target.captureSnapshot();
        check(actual.items.size() == saved.items.size(), "restore keeps item count");
        for (int i = 0; i < saved.items.size(); ++i) {
            check(actual.items[i].x == saved.items[i].x && actual.items[i].y == saved.items[i].y,
                  "restoration preserves exact saved item anchors");
            bool drawnAtAnchor = false;
            for (QGraphicsItem *item : target.items()) {
                if (auto *prop = dynamic_cast<Prop *>(item))
                    drawnAtAnchor |= prop->pos() + prop->groundAnchorOffset()
                            == QPointF(actual.items[i].x, actual.items[i].y);
            }
            check(drawnAtAnchor, "rendered and stored item anchors agree");
        }
    };
    for (int i = 0; i < 3; ++i) {
        scene.restoreSnapshot(saved);
        assertAnchors(scene);
    }
    GameState nextState;
    GameScene next(&nextState, path);
    waitUntil([&] { return next.isReady(); });
    next.stopTicking();
    next.restoreSnapshot(saved);
    assertAnchors(next);
    auto cleared = saved;
    cleared.items.clear();
    scene.restoreSnapshot(cleared);
    scene.scriptSpawnItem("token", 6, 6);
    check(scene.captureSnapshot().items[0].x == 832, "removed pickups release their reservations");

    // Pickup distance must use the nudged anchor, too. Only the last item
    // is within 100 px; the original scripted position is 339 px away.
    // Use a separate live scene because stopTicking() is terminal.
    GameState pickupState;
    GameScene pickup(&pickupState, path);
    waitUntil([&] { return pickup.isReady(); });
    Character *hero = pickup.controlledCharacter();
    hero->setPos(hero->pos() + QPointF(1072, 1072) - hero->feetPos());
    waitUntil([&] { return pickupState.inventory.value("token") == 1; });
    check(pickup.captureSnapshot().items.size() == 2, "nudged item is collected at its rendered position");
    pickup.stopTicking();
}

static void testHpAndBuffRestoration(const QString &root)
{
    const QString path = makeMap(root, "effects", R"JS(
        function onLevelStart() {
            api.spawnCharacter('hero', 3, 3, 100);
            api.spawnCharacter('fresh', 4, 3, 100);
        }
    )JS");
    GameState state;
    GameScene scene(&state, path);
    waitUntil([&] { return scene.isReady(); });
    scene.stopTicking();
    Character *hero = scene.controlledCharacter();
    Character *follower = nullptr;
    for (QGraphicsItem *item : scene.items()) {
        if (auto *character = dynamic_cast<Character *>(item); character && character->name() == "fresh")
            follower = character;
    }
    check(follower, "find follower for effects test");
    follower->setCurrentHp(0);
    hero->setCurrentHp(40);
    scene.scriptGiveItem("shield", 1);
    scene.useItem("shield");
    check(hero->maxHp() == 110 && hero->hp() == 110, "max HP upgrade still heals living members");
    check(follower->maxHp() == 110 && follower->hp() == 0 && follower->isDead(),
          "max HP upgrade keeps dead members dead at zero HP");
    scene.scriptGiveControl("fresh");
    check(scene.controlledCharacter() == hero, "HP upgrade does not allow control of a dead follower");
    scene.scriptGiveItem("speed_potion", 1);
    scene.useItem("speed_potion");
    hero->applyTemporaryStrengthBuff(3, 20);
    hero->applyTemporaryIntelligenceBuff(5, 25);
    hero->tick(2.0);
    const auto saved = scene.captureSnapshot();
    check(saved.party[0].temporaryBuffs.speed == 4 && saved.party[0].temporaryBuffs.speedRemaining == 28,
          "snapshot records consumed potion bonus and remaining simulation duration");
    check(state.inventory.value("speed_potion") == 0, "buff potion was consumed");
    GameState nextState = state;
    GameScene next(&nextState, path);
    waitUntil([&] { return next.isReady(); });
    next.stopTicking();
    next.restoreSnapshot(saved);
    Character *restoredHero = next.controlledCharacter();
    check(restoredHero->strength() == hero->strength() && restoredHero->intelligence() == hero->intelligence()
              && restoredHero->speed() == hero->speed(), "all three temporary buff channels restore");
    check(next.captureSnapshot().party[1].hp == 0, "dead follower stays dead after restoration");
    restoredHero->tick(18.1);
    check(restoredHero->temporaryBuffs().strength == 0 && restoredHero->temporaryBuffs().speed == 4,
          "restored buffs expire independently at their saved remaining durations");
    restoredHero->tick(10.0);
    check(restoredHero->temporaryBuffs().speed == 0 && restoredHero->temporaryBuffs().intelligence == 0,
          "all restored buffs expire");
    auto oldSnapshot = saved;
    for (auto &member : oldSnapshot.party)
        member.temporaryBuffs = {};
    next.restoreSnapshot(oldSnapshot);
    check(restoredHero->speed() == 10, "snapshots without buff fields restore unbuffed defaults");
    restoredHero->applyTemporarySpeedBuff(4, 0);
    check(restoredHero->speed() == 10, "zero-duration buffs cannot become permanent");
    // Ordinary chapter population still has no temporary buffs.
    GameState chapterState = state;
    GameScene chapter(&chapterState, path);
    waitUntil([&] { return chapter.isReady(); });
    chapter.stopTicking();
    check(chapter.controlledCharacter()->speed() == 10, "temporary buffs remain local to a chapter scene");
}

static void makeSwapTilesets(const QString &root)
{
    QImage image(1280, 128, QImage::Format_ARGB32);
    for (int y = 0; y < image.height(); ++y)
        for (int x = 0; x < image.width(); ++x)
            image.setPixelColor(x, y, QColor(0, x % 128, 255));
    check(image.save(root + "/tilesets/blue.png"), "save replacement tileset");
    for (const auto &[name, water] : {std::pair{"blue", -1}, {"water0", 0}, {"water9", 9}}) {
        QJsonObject names{{"ground", 0}, {"secondary", 9}};
        if (water >= 0)
            names.insert("water", water);
        writeJson(root + "/tilesets/" + name + ".json", {{"sheet", "blue.png"}, {"tileWidth", 128},
                  {"tileHeight", 128}, {"columns", 10}, {"tiles", names}});
    }
}

static void testTilesetSwitching(const QString &root)
{
    makeSwapTilesets(root);
    const QString path = makeMap(root, "tileset_swap", "function onLevelStart(){api.setTile('secondary',1,0);}");
    GameState state;
    GameScene scene(&state, path);
    waitUntil([&] { return scene.isReady(); });
    scene.stopTicking();
    TileMapItem *terrain = nullptr;
    for (QGraphicsItem *item : scene.items())
        if (auto *mapItem = dynamic_cast<TileMapItem *>(item))
            terrain = mapItem;
    check(terrain, "find actual scene terrain renderer");
    auto paint = [&] {
        QImage result(256, 128, QImage::Format_ARGB32);
        result.fill(Qt::transparent);
        QPainter painter(&result);
        QStyleOptionGraphicsItem option;
        option.exposedRect = QRectF(0, 0, 256, 128);
        terrain->paint(&painter, &option, nullptr);
        painter.end();
        return result;
    };
    const auto green = paint(); // warm variants for both indices 0 and 9
    check(green.pixelColor(64, 64) == QColor(Qt::green), "original terrain is drawn");
    scene.scriptSetTileset("../tilesets/blue.json");
    const auto blue = paint();
    check(blue.pixelColor(64, 64).blue() == 255 && blue.pixelColor(192, 64).blue() == 255,
          "API tileset swap refreshes cached variants at indices 0 and 9");
    scene.scriptSetTileset("../tilesets/water0.json");
    const auto water0 = paint();
    check(water0.copy(0, 0, 128, 128) != blue.copy(0, 0, 128, 128)
              && water0.copy(128, 0, 128, 128) == blue.copy(128, 0, 128, 128),
          "new water metadata applies ripples only to the newly named water index");
    scene.scriptSetTileset("../tilesets/water9.json");
    const auto water9 = paint();
    check(water9.copy(0, 0, 128, 128) == blue.copy(0, 0, 128, 128)
              && water9.copy(128, 0, 128, 128) != blue.copy(128, 0, 128, 128),
          "changing water index removes old ripples and applies the new ones");
    scene.scriptSetTileset("../tilesets/blue.json");
    check(paint() == blue, "swapping to a dry tileset removes water animation");

    TileMap map;
    QString error;
    check(map.load(path, &error) && map.loadTileset("../tilesets/water9.json", &error), "load transactional fixture");
    map.setBaseTile(0, 0, 9);
    const auto revision = map.tilesetRevision();
    const QImage oldTile = map.tileSheet().tile(0).toImage();
    const QJsonObject valid{{"sheet", "blue.png"}, {"tileWidth", 128}, {"tileHeight", 128},
                            {"columns", 10}, {"tiles", QJsonObject{{"water", 0}}}};
    QVector<QJsonObject> broken;
    auto invalid = valid; invalid.insert("tileWidth", 0); broken.append(invalid);
    invalid = valid; invalid.insert("columns", 9); broken.append(invalid);
    invalid = valid; invalid.insert("sheet", "missing.png"); broken.append(invalid);
    invalid = valid; invalid.insert("tiles", QJsonObject{{"water", 10}}); broken.append(invalid);
    for (const auto &metadata : broken) {
        writeJson(root + "/tilesets/broken.json", metadata);
        check(!map.loadTileset("../tilesets/broken.json", &error), "invalid replacement tileset rejected");
        check(map.tilesetRevision() == revision && map.tileSheet().tile(0).toImage() == oldTile
                  && map.tileSheet().indexByName("water") == 9 && !map.isWalkable(64, 64),
              "failed replacement preserves revision, artwork, names, and collision");
    }
    TileSheet sheet = map.tileSheet();
    writeJson(root + "/tilesets/broken.json", broken[1]);
    sheet = map.tileSheet();
    check(!sheet.load(root + "/tilesets/broken.json", &error)
              && sheet.tile(0).toImage() == oldTile && sheet.indexByName("water") == 9,
          "standalone failed sheet loads preserve their prior state too");
    QImage largeArt(1280, 512, QImage::Format_ARGB32);
    largeArt.fill(Qt::blue);
    check(largeArt.save(root + "/tilesets/large.png"), "save shipped-size art fixture");
    writeJson(root + "/tilesets/large.json", {{"sheet", "large.png"}, {"tileWidth", 256},
              {"tileHeight", 256}, {"columns", 5}, {"tiles", QJsonObject{{"ground", 0}, {"secondary", 9}}}});
    check(map.loadTileset("../tilesets/large.json", &error) && map.tileWidth() == 128
              && map.tileSheet().tileWidth() == 256 && map.isWalkable(64, 64),
          "art cell size is independent of map grid spacing, matching shipped maps");
    scene.scriptSetTileset("../tilesets/large.json");
    check(paint().pixelColor(64, 64) == QColor(Qt::blue), "large art remains usable through the actual API");
}

static void testMovementCollision(const QString &root)
{
    const QString path = makeMap(root, "movement", "");
    TileMap map;
    SpriteSheet sheet;
    QString error;
    check(map.load(path, &error) && sheet.load(root + "/characters/hero/hero.json", &error), "load movement fixtures");
    check(!map.isWalkable(-.01, 64) && !map.isWalkable(64, -.01)
              && !map.isWalkable(-127, 64) && !map.isWalkable(1280, 64)
              && !map.isWalkable(std::numeric_limits<qreal>::infinity(), 64)
              && !map.isWalkable(64, std::numeric_limits<qreal>::quiet_NaN())
              && map.isWalkable(0, 0), "walkability rejects negative, nonfinite, and outside points before conversion");
    Character runner(sheet);
    BlockingGrid grid;
    runner.setTileMap(&map);
    runner.setBlockingAreas(&grid);
    auto move = [&] (QPointF feet, QPointF velocity) {
        runner.setPos(runner.pos() + feet - runner.feetPos());
        runner.setVelocity(velocity);
        runner.tick(.05);
        return runner.feetPos();
    };
    grid.insert(QRectF(210, 180, 28.8, 40));
    check(move({200, 200}, {1024, 0}) == QPointF(200, 200), "supported running speed cannot tunnel through a prop");
    check(move({250, 200}, {-1024, 0}) == QPointF(250, 200), "reverse movement cannot tunnel through a prop");
    check(move({200, 200}, {1024, 1024}) == QPointF(200, 251.2), "blocked X movement still slides along Y");
    check(move({215, 200}, {-1024, 0}) == QPointF(163.8, 200), "a character inside a new blocker can still step out");
    grid.clear();
    grid.insert(QRectF(180, 210, 40, .001));
    check(move({200, 200}, {0, 1024}) == QPointF(200, 200), "even a subpixel footprint blocks vertical sweeps");
    check(move({200, 250}, {0, -1024}) == QPointF(200, 250), "reverse vertical sweeps detect thin blockers");
    grid.clear();
    grid.insert(QRectF(260, 180, .001, 40));
    check(move({200, 200}, {18000, 0}) == QPointF(200, 200), "sweep searches buckets beyond the start and end buckets");
    grid.clear();
    check(move({200, 200}, {1024, 0}) == QPointF(251.2, 200), "unobstructed displacement is unchanged");
    check(map.loadTileset("../tilesets/water9.json", &error), "load water collision metadata");
    map.setBaseTile(2, 2, 9);
    check(move({200, 300}, {6000, 0}) == QPointF(200, 300), "movement cannot cross an intermediate water tile");
    check(move({500, 300}, {-6000, 0}) == QPointF(500, 300), "reverse movement cannot cross intermediate water");
    // The same check must cover the map's object layer, not just water.
    QFile file(path); check(file.open(QIODevice::ReadOnly), "read object-layer fixture");
    auto objectMap = QJsonDocument::fromJson(file.readAll()).object(); file.close();
    auto objects = objectMap.value("obj").toArray(); auto row = objects[2].toArray();
    row[2] = 0; objects[2] = row; objectMap.insert("obj", objects); writeJson(path, objectMap);
    check(map.load(path, &error), "reload object-layer fixture");
    check(move({200, 300}, {6000, 0}) == QPointF(200, 300), "movement cannot cross an intermediate object tile");
}

static void testWindowInput(const QString &root)
{
    const QString path = makeMap(root, "input", R"JS(
        function onLevelStart(){api.spawnCharacter('hero',3,3,100);api.spawnNpc('fresh',3,3);}
        function* onTalkTo(){yield api.wait(.05);yield api.say('Guide','Delayed dialogue.');api.setVar('dialogue_done',true);}
    )JS");
    qputenv("T2GU_MAP_PATH", path.toLocal8Bit());
    MainWindow window;
    window.show();
    auto *view = window.findChild<QGraphicsView *>();
    auto *overlay = window.findChild<LoadingOverlayWidget *>();
    auto *inventory = window.findChild<InventoryWidget *>();
    auto scene = [&] { return dynamic_cast<GameScene *>(view->scene()); };
    waitUntil([&] { return scene() && scene()->isReady() && !overlay->isVisible(); });
    auto press = [&] (int key) {
        QKeyEvent event(QEvent::KeyPress, key, Qt::NoModifier);
        QApplication::sendEvent(&window, &event);
    };
    press(Qt::Key_E);
    press(Qt::Key_I);
    check(inventory->isVisible() && scene()->isScriptBusy(), "inventory opens during a pending dialogue wait");
    waitUntil([&] { return scene()->isDialogueActive(); });
    check(!inventory->isVisible(), "incoming delayed dialogue closes inventory");
    press(Qt::Key_Return);
    check(!scene()->isDialogueActive() && scene()->scriptGetVar("dialogue_done", false).toBool(),
          "Enter advances the incoming dialogue directly");
    Character *hero = scene()->controlledCharacter();
    auto assertStops = [&] (bool application) {
        press(Qt::Key_D); press(Qt::Key_Shift);
        check(hero->isRunning(), "Shift enables running before deactivation");
        QPointF before = hero->feetPos(); hero->tick(.01);
        check(hero->feetPos().x() > before.x(), "movement starts before deactivation");
        if (application)
            check(QMetaObject::invokeMethod(qApp, "applicationStateChanged", Qt::DirectConnection,
                          Q_ARG(Qt::ApplicationState, Qt::ApplicationInactive)), "send application deactivation notification");
        else {
            QEvent event(QEvent::WindowDeactivate); QApplication::sendEvent(&window, &event);
        }
        before = hero->feetPos(); hero->tick(.05);
        check(hero->feetPos() == before && !hero->isRunning(), "deactivation immediately clears movement and running");
        QEvent activated(QEvent::WindowActivate); QApplication::sendEvent(&window, &activated);
        press(Qt::Key_W); hero->tick(.01);
        check(hero->feetPos().x() == before.x() && hero->feetPos().y() < before.y() && !hero->isRunning(),
              "fresh input after activation cannot retain the old direction or Shift key");
        QKeyEvent release(QEvent::KeyRelease, Qt::Key_W, Qt::NoModifier); QApplication::sendEvent(&window, &release);
    };
    assertStops(false);
    assertStops(true);
    scene()->stopTicking();
    qunsetenv("T2GU_MAP_PATH");
}

static void testWindowRestore(const QString &root)
{
    const QString path = makeMap(root, "window", R"JS(
        function onLevelStart() {
            api.spawnCharacter('window_hero', 3, 3, 100);
            const start = Date.now(); while (Date.now() - start < 35) {}
            api.spawnCharacter('window_companion', 4, 3, 100);
        }
    )JS");
    qputenv("T2GU_MAP_PATH", path.toLocal8Bit());
    qputenv("T2GU_SAVE_DIR", (root + "/saves").toLocal8Bit());
    MainWindow window;
    window.show();
    auto *view = window.findChild<QGraphicsView *>();
    auto *overlay = window.findChild<LoadingOverlayWidget *>();
    auto *inventory = window.findChild<InventoryWidget *>();
    check(view && overlay && inventory, "find window controls");
    auto scene = [&] { return dynamic_cast<GameScene *>(view->scene()); };
    auto press = [&] (int key) {
        QKeyEvent event(QEvent::KeyPress, key, Qt::NoModifier);
        QApplication::sendEvent(&window, &event);
    };
    int blockedProbes = 0;
    QTimer probe;
    QObject::connect(&probe, &QTimer::timeout, &window, [&] {
        if (overlay->isVisible()) {
            press(Qt::Key_I);
            check(!inventory->isVisible(), "input remains blocked during population and restoration");
            ++blockedProbes;
        }
    });
    probe.start(1);
    waitUntil([&] { return scene() && scene()->isReady() && !overlay->isVisible(); });
    auto saved = scene()->captureSnapshot();
    check(saved.party.size() == 2, "window waits for full initial party");
    saved.party[0].x += 128;
    saved.party[1].x += 384;
    saved.party[1].y += 128;
    scene()->restoreSnapshot(saved);
    Character *buffedHero = scene()->controlledCharacter();
    buffedHero->applyTemporaryStrengthBuff(3, 20);
    buffedHero->applyTemporaryIntelligenceBuff(5, 25);
    buffedHero->applyTemporarySpeedBuff(4, 30);
    saved = scene()->captureSnapshot();
    press(Qt::Key_F5);
    // Add a valid cold-cache enemy to the saved fixture, representing an
    // entity from a prior process that this process has not decoded yet.
    const QString savePath = root + "/saves/save.json";
    QFile file(savePath);
    check(file.open(QIODevice::ReadOnly), "window writes isolated save");
    QJsonObject save = QJsonDocument::fromJson(file.readAll()).object();
    file.close();
    QJsonObject snapshot = save.value("scene").toObject();
    check(snapshot.value("party").toArray()[0].toObject().value("temporaryBuffs").toObject().value("speed").toInt() == 4,
          "actual quicksave JSON contains temporary buffs");
    snapshot.insert("enemies", QJsonArray{QJsonObject{{"name", "window_enemy"}, {"x", 1000},
                    {"y", 1000}, {"hp", 100}, {"maxHp", 100}}});
    save.insert("scene", snapshot);
    writeJson(savePath, save);
    press(Qt::Key_Return);
    GameScene *old = scene();
    press(Qt::Key_F8);
    check(overlay->isVisible(), "quickload holds loading overlay");
    waitUntil([&] { return scene() && scene() != old && scene()->isReady() && !overlay->isVisible(); });
    const auto restored = scene()->captureSnapshot();
    check(restored.party.size() == 2 && restored.enemies.size() == 1, "quickload restores complete scene");
    const auto buffs = scene()->controlledCharacter()->temporaryBuffs();
    check(buffs.strength == 3 && buffs.intelligence == 5 && buffs.speed == 4
              && buffs.strengthRemaining > 19.9 && buffs.intelligenceRemaining > 24.9 && buffs.speedRemaining > 29.9,
          "actual quickload restores every active buff without restarting its timer");
    check(restored.enemies[0].temporaryBuffs.speed == 0, "older save entities without buff fields remain compatible");
    for (int i = 0; i < saved.party.size(); ++i)
        check(restored.party[i].x == saved.party[i].x && restored.party[i].y == saved.party[i].y,
              "quickload restores both party positions before simulation");
    check(blockedProbes > 0, "loading input guard was exercised");
    probe.stop();
    // A redirect requested in the first onLevelStart step must wait for
    // readiness instead of disappearing behind the loading input guard.
    makeMap(root, "redirect", "function onLevelStart(){api.loadLevel('destination.json');}");
    makeMap(root, "destination", "function onLevelStart(){api.spawnCharacter('window_hero',3,3,100);api.setVar('arrived',true);}");
    scene()->scriptLoadLevel("redirect.json");
    waitUntil([&] { return scene() && scene()->isReady() && !overlay->isVisible()
                           && scene()->scriptGetVar("arrived", false).toBool(); });
    scene()->stopTicking();
    qunsetenv("T2GU_MAP_PATH");
    qunsetenv("T2GU_SAVE_DIR");
}

void EngineRegressionAccess::testProjectileAndSelection(const QString &root)
{
    GameState state;
    GameScene scene(&state, makeMap(root, "projectile_clock", R"JS(
        function onLevelStart(){
            api.spawnCharacter('hero',3,3,100);
            api.spawnCharacter('fresh',1,1,100);
            api.spawnEnemy('enemy',6,3,500);
        }
    )JS"));
    waitUntil([&] { return scene.isReady(); });
    scene.pauseSimulation();
    Character *hero = scene.controlledCharacter();
    Character *target = scene.m_enemies[0].character;
    scene.castFireball(hero, target, true);
    QPointer<FireballItem> bolt = scene.m_pendingFireballHits[0].visual;
    const qreal duration = scene.m_pendingFireballHits[0].timeRemaining;
    auto render = [](FireballItem *item) {
        QImage image(1600, 1600, QImage::Format_ARGB32_Premultiplied);
        image.fill(Qt::transparent);
        QPainter painter(&image);
        painter.translate(400, 400);
        item->paint(&painter, nullptr, nullptr);
        return image;
    };
    scene.updatePendingFireballHits(duration / 2);
    check(target->hp() == 500, "projectile cannot damage before its flight ends");
    const QImage beforePause = render(bolt);
    QElapsedTimer pause; pause.start();
    waitUntil([&] { return pause.elapsed() >= 350; });
    check(bolt && render(bolt) == beforePause && target->hp() == 500
              && scene.m_pendingFireballHits[0].timeRemaining == duration / 2,
          "wall time and event pumping cannot advance a paused projectile or damage");
    target->setPos(target->pos() + QPointF(0, 400));
    const QPointF impact = target->feetPos() - bolt->pos();
    scene.updatePendingFireballHits(duration / 2);
    check(target->hp() < 500 && scene.m_pendingFireballHits.isEmpty(), "damage lands once at visual impact");
    const int damagedHp = target->hp();
    const QImage atImpact = render(bolt);
    check(qAlpha(atImpact.pixel((impact + QPointF(400, 400)).toPoint())) > 0,
          "impact flash follows the original moving target");
    target->setPos(target->pos() + QPointF(0, -600));
    scene.updatePendingFireballHits(.165);
    const QImage fading = render(bolt);
    const QRectF bounds = bolt->boundingRect();
    bool expandedFlash = false;
    const qreal glow = 44.0 + (hero->intelligence() - 12) * 2.6;
    for (int y = 0; y < fading.height(); ++y) {
        for (int x = 0; x < fading.width(); ++x) {
            if (!qAlpha(fading.pixel(x, y)))
                continue;
            const QPointF local(x - 400 + .5, y - 400 + .5);
            check(bounds.contains(local), "fireball bounds cover every painted impact pixel");
            if (local.x() > impact.x() + glow * 2)
                expandedFlash = true;
        }
    }
    check(expandedFlash && target->hp() == damagedHp, "full expanding flash stays at impact and cannot repeat damage");
    scene.updatePendingFireballHits(.1);
    check(!bolt && scene.m_fireballVisuals.isEmpty(), "completed projectile is removed on simulation time");

    scene.castFireball(hero, target, true);
    bolt = scene.m_pendingFireballHits[0].visual;
    scene.destroyEntity(scene.m_enemies.takeFirst().character);
    check(!bolt && scene.m_pendingFireballHits.isEmpty(), "removing a target cancels its projectile safely");
    scene.updatePendingFireballHits(.05);
    check(scene.m_fireballVisuals.isEmpty(), "cancelled visual bookkeeping is released");
    scene.scriptSpawnEnemy("enemy", 6, 3, 500);
    target = scene.m_enemies[0].character;
    scene.castFireball(target, hero, false);
    hero->setCurrentHp(1);
    scene.m_controlledIndex = 1;
    scene.destroyEntity(scene.m_enemies.takeFirst().character);
    scene.updatePendingFireballHits(1);
    check(hero->isDead() && !scene.controlledCharacter()->isDead() && !scene.m_playerDeathNotified,
          "caster removal and control switch preserve the original target without game over");
    scene.castFireball(scene.controlledCharacter(), hero, false);
    bolt = scene.m_pendingFireballHits[0].visual;
    const auto snapshot = scene.captureSnapshot();
    check(scene.restoreSnapshot(snapshot) && !bolt && scene.m_pendingFireballHits.isEmpty()
              && scene.m_fireballVisuals.isEmpty(), "snapshot restoration discards all in-flight effects");

    GameState selectedState;
    GameScene selected(&selectedState, makeMap(root, "selection_live",
        "function onLevelStart(){api.spawnCharacter('hero',3,3,100);}"));
    waitUntil([&] { return selected.isReady(); });
    selected.m_tickTimer.stop();
    hero = selected.controlledCharacter();
    int updates = 0;
    GameScene::SelectionInfo info;
    QObject::connect(&selected, &GameScene::selectionChanged, &selected,
                     [&](const GameScene::SelectionInfo &value) { ++updates; info = value; });
    selected.trySelect(hero, selected.selectionInfoForCharacter(hero), 0);
    const qint64 portraitKey = info.portrait.cacheKey();
    hero->applyDamage(30); selected.onTick();
    check(updates == 2 && info.hp == 70, "selected HP updates after damage without reselection");
    selected.onTick();
    check(updates == 2, "unchanged selection does not emit repeated UI updates");
    hero->heal(10); selected.onTick();
    check(updates == 3 && info.hp == 80, "selected HP updates after healing");
    hero->setMaxHp(150); selected.scriptGiveExperience(100); selected.onTick();
    check(updates == 4 && info.hp == 150 && info.maxHp == 150 && info.level == 2
              && info.portrait.cacheKey() == portraitKey, "selected progression refreshes numbers and reuses the portrait");
    hero->applyDamage(1000); selected.onTick();
    check(updates == 5 && info.hp == 0, "selected death displays zero HP");
    selected.deselectCurrent(); selected.onTick();
    check(updates == 5 && !selected.m_selectedItem, "deselected entities stop sending info updates");

    InventoryWidget inventory;
    selectedState.inventory = {{"shield", 1}, {"speed_potion", 3}, {"token", 1}};
    inventory.refresh(selected.inventoryEntries());
    inventory.moveSelection(1);
    check(inventory.selectedItemId() == "speed_potion", "select the consumable after the first inventory row");
    for (int count : {2, 1}) {
        selected.useItem(inventory.selectedItemId());
        inventory.refresh(selected.inventoryEntries());
        check(inventory.selectedItemId() == "speed_potion" && selectedState.inventory.value("speed_potion") == count,
              "repeated inventory use stays on the same consumable stack");
    }
    selected.useItem(inventory.selectedItemId()); inventory.refresh(selected.inventoryEntries());
    check(inventory.selectedItemId() == "token", "exhausted stack selects the nearest remaining row");
    selectedState.inventory.clear(); inventory.refresh(selected.inventoryEntries());
    check(inventory.selectedItemId().isEmpty(), "empty inventory has no stale selection");
    selected.stopTicking();
}

void EngineRegressionAccess::testRenderingAndDefeatPositions(const QString &root)
{
    auto render = [](QGraphicsScene &scene, QRectF source) {
        QImage image(source.size().toSize(), QImage::Format_ARGB32_Premultiplied);
        image.fill(Qt::transparent);
        QPainter painter(&image);
        scene.render(&painter, QRectF(image.rect()), source, Qt::IgnoreAspectRatio);
        return image;
    };
    QGraphicsScene shadows;
    auto *prop = new Prop(root + "/items/token.png", 32);
    shadows.addItem(prop);
    const QRectF artBounds = prop->boundingRect(), footprint = prop->footprintRect();
    const QPointF anchor = prop->groundAnchorOffset();
    check(artBounds == QRectF(0, 0, 32, 32) && anchor == QPointF(16, 32), "prop anchors use the full art rectangle");
    const QImage full = render(shadows, QRectF(0, 0, 64, 80));
    const QImage edge = render(shadows, QRectF(0, 42, 64, 16));
    check(qAlpha(full.pixel(16, 50)) > 0 && edge == full.copy(0, 42, 64, 16),
          "viewport showing only an out-of-art shadow renders it without culling");
    prop->setShadowOffset(QPointF(-40, -40));
    const QImage shifted = render(shadows, QRectF(-40, -20, 40, 20));
    check(qAlpha(shifted.pixel(16, 12)) > 0 && prop->boundingRect() == artBounds
              && prop->footprintRect() == footprint && prop->groundAnchorOffset() == anchor,
          "moving a shadow updates its bounds without changing art or collision geometry");
    prop->setTransformOriginPoint(artBounds.center()); prop->setRotation(90);
    const QPointF rotatedCenter = prop->mapToScene(anchor + QPointF(-40, -40));
    const QImage rotated = render(shadows, QRectF(rotatedCenter - QPointF(12, 12), QSizeF(24, 24)));
    check(qAlpha(rotated.pixel(12, 12)) > 0, "rotated border props also retain their out-of-art shadows");

    GameState state;
    const QString path = makeMap(root, "render_layers", "function onLevelStart(){api.spawnCharacter('hero',3,3,100);}");
    QFile file(path); check(file.open(QIODevice::ReadOnly), "read layer map");
    QJsonObject map = QJsonDocument::fromJson(file.readAll()).object(); file.close();
    map.insert("lighting", "cavern"); writeJson(path, map);
    GameScene scene(&state, path);
    waitUntil([&] { return scene.isReady(); });
    scene.pauseSimulation();
    scene.scriptSpawnItem("token", 6, 6);
    Prop *pickup = scene.m_worldItems[0].prop;
    auto *cover = scene.addRect(QRectF(780, 770, 120, 120), Qt::NoPen, Qt::black);
    cover->setZValue(2000);
    scene.m_lightingOverlayItem->hide();
    QImage unlit = render(scene, QRectF(800, 784, 64, 64));
    check(unlit.pixelColor(32, 32) == QColor(Qt::white), "pickups remain visible over higher-ground scenery");
    scene.m_lightingOverlayItem->show();
    const QImage lit = render(scene, QRectF(800, 784, 64, 64));
    check(lit.pixelColor(32, 32) != unlit.pixelColor(32, 32)
              && pickup->zValue() < scene.m_lightingOverlayItem->zValue(), "actual world lighting tints pickups");
    auto *bolt = new FireballItem(&scene, QPointF(680, 816), QPointF(832, 816), .12, 12);
    bolt->tick(.12);
    const QImage litBolt = render(scene, QRectF(800, 784, 64, 64));
    scene.m_lightingOverlayItem->hide();
    const QImage unlitBolt = render(scene, QRectF(800, 784, 64, 64));
    check(litBolt.pixelColor(32, 32) != unlitBolt.pixelColor(32, 32)
              && bolt->zValue() > pickup->zValue() && bolt->zValue() < SceneLayers::Lighting,
          "projectiles draw above pickups and also receive the world wash");
    scene.m_lightingOverlayItem->show();
    scene.showLevelUpEffect();
    QPointer<LevelUpTextItem> caption = scene.m_levelUpEffects[0];
    check(!caption->parentItem() && caption->parent() == &scene
              && caption->zValue() > SceneLayers::Lighting, "notification is scene-owned and truly above top-level world layers");
    auto *captionCover = scene.addRect(caption->sceneBoundingRect(), Qt::NoPen, Qt::black);
    captionCover->setZValue(SceneLayers::Lighting + 1);
    const QImage captionEdge = render(scene, QRectF(caption->pos() + QPointF(-90, -10), QSizeF(180, 20)));
    bool gold = false;
    for (int y = 0; y < captionEdge.height(); ++y)
        for (int x = 0; x < captionEdge.width(); ++x) {
            const QColor color = captionEdge.pixelColor(x, y);
            gold |= color.red() > 150 && color.green() > 100 && color.blue() < 90;
        }
    check(gold, "caption paints above unrelated occluders even at a viewport edge");
    Character *hero = scene.controlledCharacter();
    const QPointF oldPosition = caption->pos();
    hero->setPos(hero->pos() + QPointF(128, 64));
    waitUntil([&] { return caption && caption->pos() == oldPosition + QPointF(128, 64); });
    check(caption, "top-level notification follows its original character");
    scene.destroyEntity(scene.m_party.takeFirst());
    check(!caption && scene.m_levelUpEffects.isEmpty(), "deleting an anchor cancels its notification before timer access");
    scene.scriptSpawnCharacter("fresh", 2, 2, 100);
    scene.showLevelUpEffect();
    caption = scene.m_levelUpEffects[0];
    waitUntil([&] { return !caption; });
    check(!caption, "notification also expires normally without leaking a top-level item");
    scene.stopTicking();

    GameState defeatState;
    GameScene defeat(&defeatState, makeMap(root, "defeat_position", R"JS(
        function onLevelStart(){api.spawnCharacter('hero',1,1,100);api.spawnEnemy('enemy',6,6,1);}
        function* hold(){yield api.wait(1);}
        function onEnemyDefeated(name,x,y){
            api.setVar('death_name',name);api.setVar('death_x',x);api.setVar('death_y',y);
            api.spawnEnemyAtWorld('restored',x,y,77);api.spawnItemAtWorld('token',x,y);
        }
        function badWorld(){
            api.spawnEnemyAtWorld('enemy',NaN,20);api.spawnEnemyAtWorld('enemy',20,Infinity);
            api.spawnEnemyAtWorld('enemy',-.01,20);api.spawnEnemyAtWorld('enemy',1280,20);
            api.spawnItemAtWorld('token',20,NaN);api.spawnItemAtWorld('token',20,-.01);
            api.spawnItemAtWorld('token',20,1280);
        }
    )JS"));
    waitUntil([&] { return defeat.isReady(); });
    defeat.m_tickTimer.stop(); defeat.m_lootPool.clear();
    defeat.m_scriptEngine.callEntryPoint("hold");
    Character *enemy = defeat.m_enemies[0].character;
    const QPointF deathPoint(821.25, 840.75); // same reserved spawn cell, away from its center
    enemy->setPos(enemy->pos() + deathPoint - enemy->feetPos());
    hero = defeat.controlledCharacter();
    hero->setPos(hero->pos() + deathPoint - QPointF(32, 0) - hero->feetPos());
    defeat.triggerPlayerAttack();
    check(enemy->isDead() && defeat.scriptGetVar("death_name", "").toString().isEmpty(),
          "defeat coordinates wait behind the active coroutine");
    enemy->setPos(enemy->pos() + QPointF(256, 128));
    defeat.updateCorpseCleanup(10);
    check(defeat.m_enemies.isEmpty(), "corpse is gone before queued defeat dispatch");
    defeat.m_scriptEngine.onTick(2);
    waitUntil([&] { return defeat.scriptGetVar("death_name", "").toString() == "enemy"; });
    check(defeat.scriptGetVar("death_x", 0).toDouble() == deathPoint.x()
              && defeat.scriptGetVar("death_y", 0).toDouble() == deathPoint.y()
              && defeat.m_enemies[0].character->feetPos() == deathPoint
              && defeat.m_enemies[0].character->maxHp() == 77,
          "defeat event retains the captured point and exact world spawn bypasses historical reservations");
    check(defeat.m_worldItems[0].worldX == deathPoint.x() && defeat.m_worldItems[0].worldY == deathPoint.y(),
          "world-coordinate pickup API preserves a clear fractional ground anchor");
    const auto snapshot = defeat.captureSnapshot();
    check(defeat.restoreSnapshot(snapshot) && defeat.m_enemies[0].character->feetPos() == deathPoint,
          "world-spawned phase positions survive exact scene restoration");
    defeat.m_scriptEngine.callEntryPoint("badWorld");
    check(defeat.m_enemies.size() == 1 && defeat.m_worldItems.size() == 1, "world APIs reject nonfinite, negative and edge/outside anchors");
    defeat.stopTicking();
}

int EngineRegressionAccess::chapterSmoke(QApplication &app, const QString &mapPath)
{
    QTemporaryDir saves;
    check(saves.isValid(), "create isolated smoke save directory");
    qputenv("T2GU_SAVE_DIR", saves.path().toLocal8Bit());
    qputenv("T2GU_MAP_PATH", mapPath.toLocal8Bit());
    MainWindow window;
    window.show();
    QTimer poll;
    bool working = false;
    QObject::connect(&poll, &QTimer::timeout, &app, [&] {
        if (working || window.m_levelTransitionPending || !window.m_scene
                || !window.m_scene->isReady())
            return;
        working = true; // cold decoding/queued events can pump the event loop
        GameScene &scene = *window.m_scene;
        for (int i = 0; i < 100 && scene.isScriptBusy(); ++i) {
            scene.advanceDialogue();
            scene.m_scriptEngine.onTick(1000);
            QCoreApplication::processEvents();
            check(window.m_scene == &scene && !window.m_levelTransitionPending,
                  "smoke intro unexpectedly changed levels");
        }
        check(!scene.isScriptBusy(), "chapter smoke intro did not settle");
        const auto snapshot = scene.captureSnapshot();
        qInfo("POPULATED party=%lld enemies=%lld npcs=%lld items=%lld",
              static_cast<long long>(snapshot.party.size()),
              static_cast<long long>(snapshot.enemies.size()),
              static_cast<long long>(snapshot.npcs.size()),
              static_cast<long long>(snapshot.items.size()));
        poll.stop();
        QTimer::singleShot(2500, &app, [&] {
            qInfo("CHAPTER_SMOKE_COMPLETE");
            app.quit();
        });
    });
    poll.start(50);
    return app.exec();
}

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    if (argc == 3 && QString::fromLocal8Bit(argv[1]) == QStringLiteral("--chapter-smoke"))
        return EngineRegressionAccess::chapterSmoke(app, QString::fromLocal8Bit(argv[2]));
    check(argc == 1, "expected no arguments or --chapter-smoke MAP");
    QTemporaryDir fixtures;
    check(fixtures.isValid(), "create temporary fixtures");
    testScriptEngine(fixtures.path());
    makeAssets(fixtures.path());
    qputenv("T2GU_ASSET_DIR", fixtures.path().toLocal8Bit());
    testLoading(fixtures.path(), false);
    testLoading(fixtures.path(), true);
    testCombat(fixtures.path(), false);
    testCombat(fixtures.path(), true);
    testFollowerCombat(fixtures.path());
    testDeath(fixtures.path());
    testItemRestoration(fixtures.path());
    testHpAndBuffRestoration(fixtures.path());
    testTilesetSwitching(fixtures.path());
    testMalformedMaps(fixtures.path());
    testSaveValidation(fixtures.path());
    EngineRegressionAccess::testProjectileAndSelection(fixtures.path());
    EngineRegressionAccess::testRenderingAndDefeatPositions(fixtures.path());
    EngineRegressionAccess::testPathRecovery(fixtures.path());
    EngineRegressionAccess::testMusicOwnership(fixtures.path());
    testMovementCollision(fixtures.path());
    testWindowInput(fixtures.path());
    testWindowRestore(fixtures.path());
    EngineRegressionAccess::testFailedLoads(fixtures.path());
    qInfo("Engine regressions passed");
    return 0;
}

#include "EngineRegression.moc"
