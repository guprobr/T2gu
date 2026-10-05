#include "MainWindow.h"
#include "AssetPath.h"
#include "GameView.h"
#include "SaveData.h"

#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QKeyEvent>
#include <QLabel>
#include <QRegularExpression>
#include <QResizeEvent>
#include <QSaveFile>
#include <QTimer>
#include <utility>

#include "DialogueBoxWidget.h"
#include "InventoryWidget.h"
#include "DeathMenuWidget.h"
#include "LoadingOverlayWidget.h"
#include "SelectionInfoWidget.h"
#include "StatusMessageWidget.h"

namespace {
// A single quicksave slot under the user's own home directory (not
// assetDir(), which is the read-only install/source tree) - ".T2gu2",
// dot-prefixed the same way any other Linux game/tool's per-user config
// directory is, created on first save if it doesn't exist yet.
QString saveFilePath()
{
    // Allows isolated regression runs without touching the player's slot.
    const QString dir = qEnvironmentVariable("T2GU_SAVE_DIR", QDir::homePath() + QStringLiteral("/.T2gu2"));
    QDir().mkpath(dir);
    return dir + QStringLiteral("/save.json");
}

// Bumped whenever the save JSON's own shape changes in a way that needs a
// migration or an explicit compatibility decision, not on every field added
// (the save parser retains defaults for optional fields - a genuinely
// new, purely-additive field doesn't
// need a version bump, only a structural change that makes an old save
// ambiguous or wrong to interpret under the new code does).
constexpr int kCurrentSaveVersion = 2;

// GameScene::CharacterSnapshot/ItemSnapshot <-> JSON - shared by both the
// party and enemies/NPCs arrays (npcs just always have hp=maxHp=0, same as
// createCharacterAt()'s own "hp<=0 means no combat stats" convention).
QJsonArray characterSnapshotsToJson(const QVector<GameScene::CharacterSnapshot> &list)
{
    QJsonArray array;
    for (const GameScene::CharacterSnapshot &c : list) {
        QJsonObject obj;
        obj[QStringLiteral("name")] = c.name;
        obj[QStringLiteral("x")] = c.x;
        obj[QStringLiteral("y")] = c.y;
        obj[QStringLiteral("hp")] = c.hp;
        obj[QStringLiteral("maxHp")] = c.maxHp;
        const auto &buffs = c.temporaryBuffs;
        obj[QStringLiteral("temporaryBuffs")] = QJsonObject{
            {QStringLiteral("strength"), buffs.strength},
            {QStringLiteral("strengthRemaining"), buffs.strengthRemaining},
            {QStringLiteral("intelligence"), buffs.intelligence},
            {QStringLiteral("intelligenceRemaining"), buffs.intelligenceRemaining},
            {QStringLiteral("speed"), buffs.speed},
            {QStringLiteral("speedRemaining"), buffs.speedRemaining}};
        array.append(obj);
    }
    return array;
}

QJsonArray itemSnapshotsToJson(const QVector<GameScene::ItemSnapshot> &list)
{
    QJsonArray array;
    for (const GameScene::ItemSnapshot &item : list) {
        QJsonObject obj;
        obj[QStringLiteral("itemId")] = item.itemId;
        obj[QStringLiteral("x")] = item.x;
        obj[QStringLiteral("y")] = item.y;
        array.append(obj);
    }
    return array;
}


}

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this](Qt::ApplicationState state) {
        if (state != Qt::ApplicationActive)
            clearHeldInput();
    });
    // GameView defaults to OpenGL, with automatic software fallback and
    // a launch-time software override for renderer comparisons.
    m_view = new GameView(this);
    m_view->setRenderHint(QPainter::Antialiasing, false);
    // The camera used to run at a zoom other than 1.0 (145%, then a 2x
    // integer zoom tried as a middle step - see git history/this file's
    // own past comments if curious), which needed this hint on to avoid
    // jagged scaling. A real `perf record` during that 2x-zoom experiment
    // disproved the assumption that an exact-integer scale factor would be
    // materially cheaper than a fractional one: summed across all of Qt's
    // image-scale/fetch functions, the *total* cost was essentially
    // identical (~33%) whether the scale was 1.45x+bilinear or
    // 2x+nearest-neighbor - Qt's software rasterizer has no fast path for
    // "the ratio happens to be a whole number," only for a genuine
    // identity transform. At the current fixed 1.0 zoom there's no
    // scaling happening at all, so this hint has nothing to do either way
    // - left off since it costs nothing and matches the render pipeline's
    // actual behavior.
    m_view->setRenderHint(QPainter::SmoothPixmapTransform, false);
    m_view->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_view->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_view->setFrameShape(QFrame::NoFrame);
    m_view->setFocusPolicy(Qt::NoFocus); // keys are handled here, on the window
    // No camera zoom (1:1, the view's own default transform) - tried both
    // a fractional 1.45x and an integer 2x zoom first (see this file's own
    // git history), but a real `perf record` traced roughly a third of
    // total CPU time to Qt's image-scale/fetch machinery either way, with
    // no meaningful difference between the two. Qt's software rasterizer
    // has no fast path for "the view has *some* scale transform, even a
    // clean one" - only for a genuine identity transform, which is what
    // this is now. That's the only way to actually avoid that cost rather
    // than just move it between bilinear and nearest-neighbor variants of
    // the same per-pixel fetch. See MainWindow::centerOn() for the pan
    // that keeps the controlled character centered.
    setCentralWidget(m_view);
    setWindowTitle("ShadowShine");
    resize(1024, 768);

    // Child of the view itself (not of MainWindow) so it paints as an
    // overlay on top of the view's viewport rather than behind the central
    // widget - the standard trick for a HUD element over a QGraphicsView.
    m_dialogueBox = new DialogueBoxWidget(m_view);
    repositionDialogueBox();

    m_inventoryWidget = new InventoryWidget(m_view);
    repositionInventoryWidget();

    m_deathMenuWidget = new DeathMenuWidget(m_view);
    repositionDeathMenuWidget();

    m_selectionInfoWidget = new SelectionInfoWidget(m_view);
    repositionSelectionInfoWidget();

    m_statusMessages = new StatusMessageWidget(m_view);
    repositionStatusMessages();

    // Created last so it stacks on top of every other overlay by default
    // (sibling QWidgets paint in creation order) - loadLevel() also
    // explicitly raise()s it, but starting on top means a transition that
    // happens to occur while, say, the inventory is still technically
    // visible for a frame can't ever peek out from underneath it.
    m_loadingOverlay = new LoadingOverlayWidget(m_view);
    repositionLoadingOverlay();

    // Dev/debug HUD - always-on position readout (bottom-right, small) and
    // a Y-toggleable treasure-position readout (screen center, red). Not
    // part of the actual game; see updateDebugOverlays()/jumpToNextLevel().
    m_positionLabel = new QLabel(m_view);
    m_positionLabel->setStyleSheet(QStringLiteral("background-color: white; color: black; padding: 2px;"));
    QFont positionFont = m_positionLabel->font();
    positionFont.setPointSize(8);
    m_positionLabel->setFont(positionFont);
    m_positionLabel->setText(QStringLiteral("(0, 0) - tile (0, 0)"));
    m_positionLabel->adjustSize();
    repositionPositionLabel();
    m_positionLabel->show();
    m_positionLabel->raise();

    m_treasureLabel = new QLabel(m_view);
    m_treasureLabel->setStyleSheet(QStringLiteral("color: red;"));
    QFont treasureFont = m_treasureLabel->font();
    treasureFont.setPointSize(14);
    treasureFont.setBold(true);
    m_treasureLabel->setFont(treasureFont);
    m_treasureLabel->hide();

    // T2GU_MAP_PATH lets a developer boot straight into a different map
    // (e.g. the sandbox) without recompiling - defaults to the real
    // adventure's actual entry point.
    loadLevel(qEnvironmentVariable("T2GU_MAP_PATH", assetPath(QStringLiteral("/maps/chapter1.json"))));
}

void MainWindow::loadLevel(const QString &mapPath)
{
    if (m_levelTransitionPending)
        return; // already mid-transition - see its own comment
    m_levelTransitionPending = true;

    // A quick peek at the target map's own "title" field (if it has one -
    // e.g. the sandbox doesn't) before doing anything else, purely to
    // caption the loading screen below with it. Deliberately not read via
    // TileMap/GameScene - this needs to happen *before* either exists for
    // the new map.
    QString chapterTitle;
    QFile mapFile(mapPath);
    if (mapFile.open(QIODevice::ReadOnly) && mapFile.size() <= 32 * 1024 * 1024)
        chapterTitle = QJsonDocument::fromJson(mapFile.readAll()).object().value("title").toString();

    m_loadingOverlay->showLoading(chapterTitle);

    // Pause immediately, before the cosmetic delay. Suspension preserves
    // the old coroutine/queue for rollback without permitting nested JS.
    if (m_scene)
        m_scene->pauseSimulation();
    QTimer::singleShot(1000, this, [this, mapPath] { finishLoadingLevel(mapPath); });
}

void MainWindow::failLoadingLevel(const QString &error)
{
    if (m_loadingScene) {
        m_loadingScene->stopTicking();
        m_loadingScene->disconnect(this);
        m_loadingScene->deleteLater();
        m_loadingScene = nullptr;
    }
    m_pendingGameState.reset();
    m_pendingSnapshot.reset();
    m_pendingDialogue.reset();
    m_pendingStatus.clear();
    m_pendingRedirect.clear();
    m_levelTransitionPending = false;
    m_loadingOverlay->hide();
    m_statusMessages->post(QStringLiteral("Load failed: %1").arg(error), GameScene::StatusKind::Loss);
    if (m_scene)
        m_scene->resumeSimulation();
    refreshMoveIntent();
}

void MainWindow::finishLoadingLevel(const QString &mapPath)
{
    // Copy after the initiating script call has unwound: code after its
    // api.loadLevel() may still update story flags in that same JS step.
    if (!m_pendingGameState)
        m_pendingGameState = m_gameState;
    GameScene *candidate = new GameScene(&*m_pendingGameState, mapPath, this);
    candidate->setMusicEnabled(m_musicEnabled);
    m_loadingScene = candidate;
    if (!candidate->loadError().isEmpty()) {
        failLoadingLevel(candidate->loadError());
        return;
    }
    connect(candidate, &GameScene::sceneLoadFailed, this, [this, candidate](const QString &error) {
        if (m_loadingScene == candidate)
            failLoadingLevel(error);
    });
    connect(candidate, &GameScene::controlledCharacterMoved, this, [this, candidate](QPointF position) {
        if (m_scene == candidate) {
            centerViewOn(position);
            updateDebugOverlays(position);
        }
    });
    connect(candidate, &GameScene::dialogueRequested, this, [this, candidate](QString speaker, QString text) {
        if (m_scene == candidate)
            showDialogue(speaker, text);
        else if (m_loadingScene == candidate)
            m_pendingDialogue = qMakePair(speaker, text);
    });
    connect(candidate, &GameScene::dialogueEnded, this, [this, candidate] {
        if (m_scene == candidate)
            hideDialogue();
        else if (m_loadingScene == candidate)
            m_pendingDialogue.reset();
    });
    connect(candidate, &GameScene::levelChangeRequested, this, [this, candidate](const QString &path) {
        if (m_scene == candidate)
            loadLevel(path);
        else if (m_loadingScene == candidate && m_pendingRedirect.isEmpty())
            m_pendingRedirect = path;
    });
    connect(candidate, &GameScene::playerDied, this, [this, candidate] {
        if (m_scene == candidate)
            showDeathMenu();
    });
    connect(candidate, &GameScene::selectionChanged, this, [this, candidate](const GameScene::SelectionInfo &info) {
        if (m_scene == candidate)
            showSelectionInfo(info);
    });
    connect(candidate, &GameScene::selectionCleared, this, [this, candidate] {
        if (m_scene == candidate)
            hideSelectionInfo();
    });
    connect(candidate, &GameScene::statusMessage, this, [this, candidate](const QString &text, GameScene::StatusKind kind) {
        if (m_scene == candidate)
            m_statusMessages->post(text, kind);
        else if (m_loadingScene == candidate)
            m_pendingStatus.append(qMakePair(text, kind));
    });
    connect(candidate, &GameScene::sceneReady, this, [this, candidate, mapPath] {
        if (m_loadingScene != candidate)
            return;
        const bool restored = m_pendingSnapshot.has_value();
        QString error;
        if (restored && !candidate->restoreSnapshot(*m_pendingSnapshot, &error)) {
            failLoadingLevel(error);
            return;
        }
        // Commit only after all sprite decoding and restoration return.
        GameScene *oldScene = m_scene;
        if (oldScene) {
            oldScene->stopTicking();
            oldScene->disconnect(this);
            oldScene->deleteLater();
        }
        m_gameState = std::move(*m_pendingGameState);
        candidate->setGameState(&m_gameState);
        m_pendingGameState.reset();
        m_pendingSnapshot.reset();
        m_scene = candidate;
        m_loadingScene = nullptr;
        m_currentMapPath = mapPath;
        m_view->setScene(candidate);
        m_dialogueBox->hide();
        closeInventory();
        m_deathMenuOpen = false;
        m_deathMenuWidget->hide();
        hideSelectionInfo();
        if (m_pendingDialogue)
            showDialogue(m_pendingDialogue->first, m_pendingDialogue->second);
        m_pendingDialogue.reset();
        for (const auto &message : std::as_const(m_pendingStatus))
            m_statusMessages->post(message.first, message.second);
        m_pendingStatus.clear();
        if (restored)
            m_statusMessages->post(QStringLiteral("Game loaded"), GameScene::StatusKind::Progress);
        const QString redirect = std::exchange(m_pendingRedirect, QString());
        m_levelTransitionPending = false;
        m_loadingOverlay->hide();
        if (Character *controlled = candidate->controlledCharacter()) {
            centerViewOn(controlled->feetPos());
            m_debugHudClock.invalidate();
            updateDebugOverlays(controlled->feetPos());
        }
        refreshMoveIntent();
        if (!redirect.isEmpty())
            loadLevel(redirect);
    });
}

void MainWindow::centerViewOn(QPointF scenePos)
{
    m_view->centerOn(scenePos);

    // Re-applies whatever movement keys are still held every tick, not just
    // on press/release: Character::setVelocity() ignores new velocity while
    // an attack/hit/die one-shot is playing (see Character::isActing()), so
    // without this a character that finishes swinging while, say, W is
    // still held would otherwise sit idle until the key is released and
    // pressed again.
    refreshMoveIntent();
}

void MainWindow::updateDebugOverlays(QPointF playerPos)
{
    // A changing child QWidget can trigger a window-sized texture upload
    // during GL composition. Coordinates need not refresh at movement rate.
    constexpr int kHudIntervalMs = 100;
    if (m_debugHudClock.isValid() && m_debugHudClock.elapsed() < kHudIntervalMs)
        return;
    m_debugHudClock.start();
    // Raw world pixels alongside the map (col, row) tile they fall in - the
    // former is what everything else here (feetPos(), etc.) actually works
    // in, the latter is what's actually legible against the map/chapter
    // scripts, which place everything in tile units (see e.g.
    // api.spawnCharacter(name, col, row)).
    const int tileCol = static_cast<int>(playerPos.x() / m_scene->tileWidth());
    const int tileRow = static_cast<int>(playerPos.y() / m_scene->tileHeight());
    const QString positionText = QStringLiteral("(%1, %2) - tile (%3, %4)")
                                  .arg(qRound(playerPos.x()))
                                  .arg(qRound(playerPos.y()))
                                  .arg(tileCol)
                                  .arg(tileRow);
    if (m_positionLabel->text() != positionText) {
        m_positionLabel->setText(positionText);
        m_positionLabel->adjustSize();
        repositionPositionLabel();
    }

    if (!m_treasureLabelVisible)
        return;
    QPointF treasurePos;
    QString treasureText;
    if (m_scene->findKeyItemWorldPos(&treasurePos))
        treasureText = QStringLiteral("(%1, %2)").arg(qRound(treasurePos.x())).arg(qRound(treasurePos.y()));
    else
        treasureText = QStringLiteral("(collected)");
    if (m_treasureLabel->text() != treasureText) {
        m_treasureLabel->setText(treasureText);
        m_treasureLabel->adjustSize();
        repositionTreasureLabel();
    }
}

void MainWindow::showDialogue(QString speaker, QString text)
{
    closeInventory();
    m_dialogueBox->showMessage(speaker, text);
    refreshMoveIntent();
}

void MainWindow::hideDialogue()
{
    m_dialogueBox->hide();
}

bool MainWindow::event(QEvent *event)
{
    if (event->type() == QEvent::WindowDeactivate)
        clearHeldInput();
    return QMainWindow::event(event);
}

void MainWindow::clearHeldInput()
{
    m_heldKeys.clear();
    if (m_scene) {
        if (Character *character = m_scene->controlledCharacter()) {
            character->setRunning(false);
            character->setVelocity(QPointF(0, 0));
        }
    }
}

bool MainWindow::focusNextPrevChild(bool next)
{
    Q_UNUSED(next);
    return false;
}

void MainWindow::resizeEvent(QResizeEvent *event)
{
    QMainWindow::resizeEvent(event);
    repositionDialogueBox();
    repositionInventoryWidget();
    repositionDeathMenuWidget();
    repositionLoadingOverlay();
    repositionPositionLabel();
    repositionTreasureLabel();
    repositionSelectionInfoWidget();
    repositionStatusMessages();
}

void MainWindow::repositionDialogueBox()
{
    constexpr int margin = 24;
    // Grown along with DialogueBoxWidget's 2x font size bump - the old
    // 96px height was sized for 13-14px text and would clip the larger
    // labels otherwise.
    constexpr int height = 170;
    const QSize viewSize = m_view->size();
    m_dialogueBox->setGeometry(margin, viewSize.height() - height - margin, viewSize.width() - margin * 2, height);
}

void MainWindow::repositionInventoryWidget()
{
    constexpr int width = 520;
    constexpr int height = 360;
    const QSize viewSize = m_view->size();
    m_inventoryWidget->setGeometry((viewSize.width() - width) / 2, (viewSize.height() - height) / 2, width, height);
}

void MainWindow::openInventory()
{
    m_inventoryOpen = true;
    m_inventoryWidget->refresh(m_scene->inventoryEntries());
    m_inventoryWidget->show();
    m_inventoryWidget->raise();
    refreshMoveIntent(); // freeze the controlled character immediately, don't wait for the next tick
}

void MainWindow::closeInventory()
{
    m_inventoryOpen = false;
    m_inventoryWidget->hide();
}

void MainWindow::repositionDeathMenuWidget()
{
    constexpr int width = 360;
    constexpr int height = 220;
    const QSize viewSize = m_view->size();
    m_deathMenuWidget->setGeometry((viewSize.width() - width) / 2, (viewSize.height() - height) / 2, width, height);
}

void MainWindow::repositionLoadingOverlay()
{
    // Covers the entire view, unlike every other overlay here - it's meant
    // to fully hide the scene underneath during a transition, not sit
    // alongside it.
    m_loadingOverlay->setGeometry(m_view->rect());
}

void MainWindow::repositionPositionLabel()
{
    constexpr int margin = 8;
    const QSize viewSize = m_view->size();
    m_positionLabel->move(viewSize.width() - m_positionLabel->width() - margin,
                           viewSize.height() - m_positionLabel->height() - margin);
}

void MainWindow::repositionTreasureLabel()
{
    const QSize viewSize = m_view->size();
    m_treasureLabel->move((viewSize.width() - m_treasureLabel->width()) / 2,
                           (viewSize.height() - m_treasureLabel->height()) / 2);
}

void MainWindow::repositionSelectionInfoWidget()
{
    // Top-left corner - unlike the inventory/death menus this is a
    // non-modal HUD panel shown alongside ordinary play, not a screen-
    // centered menu, so it needs to stay out of the way rather than cover
    // the middle of the view.
    constexpr int width = 320;
    constexpr int height = 110;
    constexpr int margin = 8;
    m_selectionInfoWidget->setGeometry(margin, margin, width, height);
}

void MainWindow::repositionStatusMessages()
{
    // Centered at the top. With a panel selected (top-left, see
    // repositionSelectionInfoWidget()) it stays in the gap between that
    // panel and its mirror on the right; when that gap is too narrow for a
    // typical line ("Skeleton Swordsman defeated  x2" is ~290px) it drops
    // below the panel instead - eliding every line on a small window, or
    // sliding under the panel, would both hide the message. Without a
    // selection it keeps the top edge, clear of the hero's head.
    constexpr int margin = 8;
    constexpr int minGapWidth = 420;
    const QRect panel = m_selectionInfoWidget->geometry(); // positioned first, in the constructor and resizeEvent()
    const int fullWidth = m_view->width() - 2 * margin;
    const int gapWidth = m_view->width() - 2 * (panel.right() + 1 + margin);
    if (!m_selectionInfoWidget->isVisible())
        m_statusMessages->setLayoutBounds(margin, fullWidth);
    else if (gapWidth >= minGapWidth)
        m_statusMessages->setLayoutBounds(margin, gapWidth);
    else
        m_statusMessages->setLayoutBounds(panel.bottom() + 1 + margin, fullWidth);
}

void MainWindow::showSelectionInfo(const GameScene::SelectionInfo &info)
{
    m_selectionInfoWidget->showInfo(info);
    repositionStatusMessages();
}

void MainWindow::hideSelectionInfo()
{
    m_selectionInfoWidget->hide();
    repositionStatusMessages();
}

void MainWindow::showDeathMenu()
{
    // Enemy attacks aren't gated by dialogue/inventory state, so death can
    // technically happen while either is up - force them both closed first
    // rather than stacking a third modal on top.
    hideDialogue();
    closeInventory();

    m_deathMenuOpen = true;
    m_deathMenuWidget->reset();
    m_deathMenuWidget->show();
    m_deathMenuWidget->raise();
    refreshMoveIntent();
}

void MainWindow::respawnFromBeginning()
{
    m_pendingGameState = GameState();
    loadLevel(assetPath(QStringLiteral("/maps/chapter1.json")));
}

void MainWindow::saveGame()
{
    // The save has no coroutine continuation. Saving after a quest item
    // was collected but before its dialogue finishes would lose the only
    // event that advances the chapter. Do not replace the active dialogue
    // with a refusal message, or queue a save against a later scene.
    if (!m_scene || m_levelTransitionPending || m_deathMenuOpen
        || m_scene->isScriptBusy() || m_scene->isDialogueActive())
        return;

    QJsonObject root;
    root[QStringLiteral("saveVersion")] = kCurrentSaveVersion;
    // Just the map's own filename, not the full m_currentMapPath - that's
    // normally built from assetDir() (see AssetPath.h - the source tree's
    // assets/ for a run out of the build directory, the data directory for an
    // installed copy), so saving it verbatim would tie a save file to the exact
    // source/build tree it was written on, not to "chapter4," conceptually.
    // Every real
    // map lives together in one directory (see GameScene::scriptLoadLevel(),
    // which already resolves a script's `api.loadLevel("chapterN.json")`
    // relative to wherever the *current* map's own directory is, for the
    // same reason) - loadGame() resolves this filename against THIS
    // install's own assetDir(), so a save loads correctly regardless of
    // which machine or build tree wrote it.
    root[QStringLiteral("map")] = QFileInfo(m_currentMapPath).fileName();
    root[QStringLiteral("level")] = m_gameState.level;
    root[QStringLiteral("experience")] = m_gameState.experience;
    root[QStringLiteral("lastMusicTrack")] = m_gameState.lastMusicTrack;
    root[QStringLiteral("itemBonusStrength")] = m_gameState.itemBonusStrength;
    root[QStringLiteral("itemBonusIntelligence")] = m_gameState.itemBonusIntelligence;
    root[QStringLiteral("itemBonusMaxHp")] = m_gameState.itemBonusMaxHp;
    root[QStringLiteral("heroBaseMaxHp")] = m_gameState.heroBaseMaxHp;

    QJsonObject vars;
    for (auto it = m_gameState.vars.constBegin(); it != m_gameState.vars.constEnd(); ++it)
        vars[it.key()] = QJsonValue::fromVariant(it.value());
    root[QStringLiteral("vars")] = vars;

    QJsonObject inventory;
    for (auto it = m_gameState.inventory.constBegin(); it != m_gameState.inventory.constEnd(); ++it)
        inventory[it.key()] = it.value();
    root[QStringLiteral("inventory")] = inventory;

    // Everything GameState's vars/inventory/level/experience don't already
    // cover - exact positions, current HP, and precisely which enemies/
    // NPCs/items are still present. See GameScene::SceneSnapshot's own
    // comment for why this is necessary at all (a chapter's *_spawned
    // guard vars alone can only ever block re-spawning a whole batch
    // outright, never track which individual members survived).
    const GameScene::SceneSnapshot snapshot = m_scene->captureSnapshot();
    QJsonObject sceneJson;
    sceneJson[QStringLiteral("controlledName")] = snapshot.controlledName;
    sceneJson[QStringLiteral("party")] = characterSnapshotsToJson(snapshot.party);
    sceneJson[QStringLiteral("enemies")] = characterSnapshotsToJson(snapshot.enemies);
    sceneJson[QStringLiteral("npcs")] = characterSnapshotsToJson(snapshot.npcs);
    sceneJson[QStringLiteral("items")] = itemSnapshotsToJson(snapshot.items);
    root[QStringLiteral("scene")] = sceneJson;

    // QSaveFile, not QFile - it writes to a temporary file alongside the
    // real one and only replaces it atomically on a successful commit().
    // A plain QFile truncates the real save.json immediately on open(), so
    // a crash, a full disk, or the process getting killed mid-write() could
    // leave the *only* copy of the player's save half-written and
    // unreadable; QSaveFile means the previous save is never touched at all
    // unless the new one fully succeeds.
    QSaveFile file(saveFilePath());
    if (!file.open(QIODevice::WriteOnly)) {
        qWarning() << "saveGame: couldn't open" << file.fileName() << "for writing:" << file.errorString();
        m_scene->showInfoMessage(QStringLiteral("Game"), QStringLiteral("Save failed - couldn't write the save file."));
        return;
    }
    file.write(QJsonDocument(root).toJson());
    if (!file.commit()) {
        qWarning() << "saveGame: couldn't commit" << file.fileName() << ":" << file.errorString();
        m_scene->showInfoMessage(QStringLiteral("Game"), QStringLiteral("Save failed - couldn't write the save file."));
        return;
    }
    // A status line, not a dialogue box to dismiss - a successful save is
    // routine and shouldn't stop play; the failures above still do.
    m_statusMessages->post(QStringLiteral("Game saved"), GameScene::StatusKind::Progress);
}

void MainWindow::loadGame()
{
    if (!m_scene || m_levelTransitionPending)
        return;
    QFile file(saveFilePath());
    if (!file.open(QIODevice::ReadOnly)) {
        m_statusMessages->post(QStringLiteral("No save file found."), GameScene::StatusKind::Loss);
        return;
    }
    if (file.size() > kMaxSaveBytes) {
        m_statusMessages->post(QStringLiteral("Save file exceeds the 8 MiB limit."), GameScene::StatusKind::Loss);
        return;
    }
    LoadedSave saved;
    QString error;
    if (!parseSavedGame(file.read(kMaxSaveBytes + 1), saved, error)) {
        m_statusMessages->post(error, GameScene::StatusKind::Loss);
        return;
    }
    m_pendingGameState = std::move(saved.state);
    m_pendingSnapshot = std::move(saved.snapshot);
    loadLevel(saved.mapPath);
}

void MainWindow::jumpToNextLevel()
{
    static const QRegularExpression re(QStringLiteral("chapter(\\d+)\\.json$"));
    const QRegularExpressionMatch match = re.match(m_currentMapPath);
    if (!match.hasMatch())
        return; // not on a numbered chapter map (sandbox, a tileset test map) - nothing to jump to

    const int nextChapter = match.captured(1).toInt() + 1;
    const QString nextPath = assetPath(QStringLiteral("/maps/chapter%1.json")).arg(nextChapter);
    if (!QFileInfo::exists(nextPath))
        return; // already on the last chapter
    loadLevel(nextPath);
}

void MainWindow::keyPressEvent(QKeyEvent *event)
{
    // During loading the scene is either absent or already retired; even
    // a save/load shortcut must not read or mutate that intermediate state.
    if (!m_scene || m_levelTransitionPending) {
        event->accept();
        return;
    }

    if (event->key() == Qt::Key_M) {
        if (!event->isAutoRepeat()) {
            m_musicEnabled = !m_musicEnabled;
            m_scene->setMusicEnabled(m_musicEnabled);
            m_statusMessages->post(m_musicEnabled ? QStringLiteral("Music on") : QStringLiteral("Music off"),
                                   GameScene::StatusKind::Progress);
        }
        event->accept();
        return;
    }

    if (m_deathMenuOpen) {
        // Death overrides browsing the inventory and other gameplay input.
        if (event->isAutoRepeat())
            return;
        const int key = event->key();
        if (key == Qt::Key_Up || key == Qt::Key_W || key == Qt::Key_Down || key == Qt::Key_S) {
            m_deathMenuWidget->moveSelection(key == Qt::Key_Up || key == Qt::Key_W ? -1 : 1);
        } else if (key == Qt::Key_Return || key == Qt::Key_Enter) {
            if (m_deathMenuWidget->selectedAction() == DeathMenuWidget::Action::RespawnFromBeginning)
                respawnFromBeginning();
            else
                QApplication::quit();
        }
        return;
    }

    if (m_inventoryOpen) {
        // The menu takes over input entirely while open - same priority
        // dialogue already has over normal game keys, just with its own
        // small set of bindings instead of forwarding to them.
        if (event->isAutoRepeat())
            return;
        const int key = event->key();
        if (key == Qt::Key_Up || key == Qt::Key_W) {
            m_inventoryWidget->moveSelection(-1);
        } else if (key == Qt::Key_Down || key == Qt::Key_S) {
            m_inventoryWidget->moveSelection(1);
        } else if (key == Qt::Key_Return || key == Qt::Key_Enter) {
            const QString itemId = m_inventoryWidget->selectedItemId();
            if (!itemId.isEmpty()) {
                m_scene->useItem(itemId);
                if (m_scene->isDialogueActive()) {
                    // Using this item triggered a message (the compass) or
                    // a script dialogue (onItemUsed) - hand off to the
                    // normal dialogue-Enter-to-dismiss path instead of
                    // leaving two modal UIs both wanting Enter/movement-
                    // lock at once, which would strand the player with no
                    // way to dismiss either.
                    closeInventory();
                } else {
                    m_inventoryWidget->refresh(m_scene->inventoryEntries());
                }
            }
        } else if (key == Qt::Key_I || key == Qt::Key_Escape) {
            closeInventory();
        }
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_I) {
        // Opening while a real script dialogue is up would fight it for
        // Enter/movement-lock - just don't, the same way the inventory
        // itself refuses to open a second time.
        if (!m_scene->isDialogueActive())
            openInventory();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_Tab) {
        m_scene->switchToNextCharacter();
        refreshMoveIntent();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_C) {
        // Command whichever character was last left-clicked (see
        // GameScene::mousePressEvent) - no-op if nothing is selected.
        m_scene->commandSelectedCharacter();
        refreshMoveIntent();
        return;
    }

    if (!event->isAutoRepeat() && (event->key() == Qt::Key_Return || event->key() == Qt::Key_Enter)) {
        // Advances a script's dialogue box, same as the old Space-while-
        // dialogue-active behavior - no-op if nothing is showing.
        if (m_scene->isDialogueActive())
            m_scene->advanceDialogue();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_Control) {
        // Attack - only while no dialogue is up, same guard the old
        // contextual Space key gave for free.
        if (!m_scene->isDialogueActive())
            m_scene->triggerPlayerAttack();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_F) {
        // Fireball - same dialogue guard as Ctrl's melee attack. A no-op if
        // the controlled character isn't intelligent enough to cast at all,
        // is still on cooldown, or has nothing in range - see
        // GameScene::triggerPlayerFireball().
        if (!m_scene->isDialogueActive())
            m_scene->triggerPlayerFireball();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_H) {
        m_scene->toggleHealthBarDisplay();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_K) {
        // Dev/debug shortcut - loops the controlled character through every
        // animation row (including hit/die/defend/dash/jump, which nothing
        // in the real game ever triggers outside combat, or at all) so a
        // new sprite batch can be checked live through the engine instead
        // of just as a static crop of the sheet file. See
        // GameScene::togglePosePreview().
        m_scene->togglePosePreview();
        refreshMoveIntent(); // freeze movement immediately if a preview just started
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_N) {
        // Dev/debug shortcut - skip straight to the next chapter.
        jumpToNextLevel();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_Y) {
        // Dev/debug shortcut - toggle the current chapter's key-item
        // (treasure) position readout.
        m_treasureLabelVisible = !m_treasureLabelVisible;
        m_treasureLabel->setVisible(m_treasureLabelVisible);
        if (m_treasureLabelVisible) {
            QPointF treasurePos;
            if (m_scene->findKeyItemWorldPos(&treasurePos))
                m_treasureLabel->setText(QStringLiteral("(%1, %2)").arg(qRound(treasurePos.x())).arg(qRound(treasurePos.y())));
            else
                m_treasureLabel->setText(QStringLiteral("(collected)"));
            m_treasureLabel->adjustSize();
            repositionTreasureLabel();
        }
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_E) {
        m_scene->interactWithNearby();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_F5) {
        saveGame();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_F8) {
        loadGame();
        return;
    }

    if (!event->isAutoRepeat() && event->key() == Qt::Key_F9) {
        // Kills the controlled character on the spot - playerDied() (see
        // GameScene::killControlledCharacter()) brings up the same
        // respawn-from-beginning/quit menu a real death in combat does,
        // so this is a fast way to bail into a fresh game (or quit)
        // without needing to actually find something to die to first.
        m_scene->killControlledCharacter();
        return;
    }

    if (!event->isAutoRepeat()) {
        m_heldKeys.insert(event->key());
        refreshMoveIntent();
    }
    QMainWindow::keyPressEvent(event);
}

void MainWindow::keyReleaseEvent(QKeyEvent *event)
{
    if (!event->isAutoRepeat()) {
        m_heldKeys.remove(event->key());
        refreshMoveIntent();
    }
    QMainWindow::keyReleaseEvent(event);
}

void MainWindow::refreshMoveIntent()
{
    if (!m_scene || m_levelTransitionPending)
        return;

    Character *character = m_scene->controlledCharacter();
    if (!character)
        return; // no party loaded (e.g. assets/characters/ is empty) - nothing to drive

    if (m_scene->isDialogueActive() || m_inventoryOpen || m_deathMenuOpen || m_scene->isPosePreviewActive()) {
        // Held movement keys must not carry the player anywhere while a
        // line of dialogue, the inventory menu, the death menu, or a K-key
        // pose preview (see GameScene::togglePosePreview()) is up.
        // The dialogue case used to let someone wander into a story area
        // before finishing the conversation that was meant to gate it,
        // since that area's props/enemies only spawn once the conversation
        // actually concludes. Called every tick (via
        // centerViewOn), so this takes effect within one frame of any of
        // them starting and releases just as fast the moment it ends - no
        // extra signal wiring needed for any direction. (In practice a
        // dead controlled character is already frozen via Character's own
        // isActing()/isDead() lock on the "die" animation, but this stays
        // consistent with the other two states rather than relying on
        // that being coincidentally true.)
        character->setVelocity(QPointF(0.0, 0.0));
        return;
    }

    // Kept in sync by convention (not a shared header) with the identical
    // constant in GameScene.cpp's updateEnemyAI() - both express "how many
    // px/s does one point of Speed buy". A character with no stats.json
    // entry (speed() == 0) falls back to the old flat 160 px/s everyone
    // used to move at before Speed existed.
    constexpr qreal kSpeedStatToPixelsPerSecond = 32.0;
    constexpr qreal kFallbackSpeed = 320.0; // pixels/second
    // Either Shift key runs - held, not toggled, same as every movement key
    // here, and checked independent of which direction key(s) are actually
    // down so it still applies to diagonal movement.
    constexpr qreal kRunSpeedMultiplier = 1.6;
    const bool running = m_heldKeys.contains(Qt::Key_Shift);
    qreal speed = character->speed() > 0 ? character->speed() * kSpeedStatToPixelsPerSecond : kFallbackSpeed;
    if (running)
        speed *= kRunSpeedMultiplier;
    qreal vx = 0.0;
    qreal vy = 0.0;

    if (m_heldKeys.contains(Qt::Key_Down) || m_heldKeys.contains(Qt::Key_S))
        vy += speed;
    if (m_heldKeys.contains(Qt::Key_Up) || m_heldKeys.contains(Qt::Key_W))
        vy -= speed;
    if (m_heldKeys.contains(Qt::Key_Left) || m_heldKeys.contains(Qt::Key_A))
        vx -= speed;
    if (m_heldKeys.contains(Qt::Key_Right) || m_heldKeys.contains(Qt::Key_D))
        vx += speed;

    // Purely cosmetic (see Character::setRunning()) - doesn't affect the
    // velocity just computed above, which already has the run multiplier
    // baked in regardless of animation.
    character->setRunning(running);
    character->setVelocity(QPointF(vx, vy));
}
