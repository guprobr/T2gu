#pragma once

#include <QGraphicsView>
#include <QElapsedTimer>
#include <QMainWindow>
#include <QSet>

#include <optional>

#include "game/Character.h"
#include "game/GameScene.h"
#include "game/GameState.h"

class DialogueBoxWidget;
class InventoryWidget;
class DeathMenuWidget;
class LoadingOverlayWidget;
class SelectionInfoWidget;
class StatusMessageWidget;
class QResizeEvent;
class QLabel;

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

protected:
    bool event(QEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    // Tab is a game key here (switch controlled character), not focus
    // navigation - without this override Qt intercepts it before
    // keyPressEvent ever sees it.
    bool focusNextPrevChild(bool next) override;
    // Keeps the dialogue box anchored to the bottom of the view, and the
    // inventory/death menus centered in it, as the window is resized.
    void resizeEvent(QResizeEvent *event) override;

private slots:
    void centerViewOn(QPointF scenePos);
    void showDialogue(QString speaker, QString text);
    void hideDialogue();
    // Connected to GameScene::controlledCharacterMoved (same signal
    // centerViewOn() uses) - keeps the always-on position readout and, if
    // toggled on, the treasure readout current at a throttled HUD cadence.
    void updateDebugOverlays(QPointF playerPos);
    // Prepares a fresh scene/state, commits on readiness, and preserves
    // the old playable scene on failure. GameState survives successful
    // transitions; scene-local entities are replaced. Connected to the current scene's
    // GameScene::levelChangeRequested (see GameScene::scriptLoadLevel);
    // also called directly, once, to boot the very first map.
    void loadLevel(const QString &mapPath);
    // Connected to GameScene::playerDied - force-closes the inventory/
    // dialogue (either could technically be open, since enemy attacks
    // aren't gated by either state) and shows the respawn/quit menu, which
    // then takes input priority over everything else.
    void showDeathMenu();
    // Connected to GameScene::selectionChanged/selectionCleared (see
    // mousePressEvent's click-to-select handling) - unlike the inventory/
    // death menus, this never pauses movement or takes input priority.
    void showSelectionInfo(const GameScene::SelectionInfo &info);
    void hideSelectionInfo();

private:
    friend class EngineRegressionAccess;
    void clearHeldInput();
    void refreshMoveIntent();
    void repositionDialogueBox();
    void repositionInventoryWidget();
    void repositionDeathMenuWidget();
    void repositionLoadingOverlay();
    // Deferred preparation keeps the old scene suspended until the
    // candidate's first script step and optional restore have succeeded.
    void finishLoadingLevel(const QString &mapPath);
    void failLoadingLevel(const QString &error);
    // Opens/refreshes the inventory menu and pauses movement/attack while
    // it's up; closing just hides it. See m_inventoryOpen and the
    // isDialogueActive()-style guard in refreshMoveIntent().
    void openInventory();
    void closeInventory();
    // Resets GameState entirely (fresh vars/inventory, no fear of leftover
    // story flags from the run that just ended) and boots the real story
    // entry point again - a genuine full restart, not just a scene reload.
    void respawnFromBeginning();
    // GameState plus the scene snapshot, in a single slot. A script's
    // coroutine/queued events cannot be restored, so F5 is ignored while
    // a script or dialogue is active or a scene transition is pending.
    void saveGame();
    void loadGame();
    // Dev/debug shortcut (N key) - jumps straight to "chapterN+1.json" from
    // whatever "chapterN.json" is currently loaded, skipping however much
    // of the current chapter remains. No-op on a non-chapter map (sandbox,
    // a tileset test map) or if there's no chapterN+1.json on disk (already
    // on the last chapter).
    void jumpToNextLevel();
    void repositionPositionLabel();
    void repositionTreasureLabel();
    void repositionSelectionInfoWidget();
    void repositionStatusMessages();

    GameState m_gameState; // persists across loadLevel() calls - owns story vars/inventory
    GameScene *m_scene = nullptr;
    // True from the moment loadLevel() starts a transition until
    // the new scene finishes its initial population and snapshot restore.
    // Guards against a second loadLevel() call (another script race, a
    // dev-key mash) landing mid-
    // transition and stacking a second overlay/timer/scene-swap on top of
    // the first.
    bool m_levelTransitionPending = false;
    GameScene *m_loadingScene = nullptr;
    std::optional<GameState> m_pendingGameState;
    std::optional<GameScene::SceneSnapshot> m_pendingSnapshot;
    std::optional<QPair<QString, QString>> m_pendingDialogue;
    QVector<QPair<QString, GameScene::StatusKind>> m_pendingStatus;
    QString m_pendingRedirect;
    QGraphicsView *m_view = nullptr;
    DialogueBoxWidget *m_dialogueBox = nullptr;
    InventoryWidget *m_inventoryWidget = nullptr;
    DeathMenuWidget *m_deathMenuWidget = nullptr;
    LoadingOverlayWidget *m_loadingOverlay = nullptr;
    SelectionInfoWidget *m_selectionInfoWidget = nullptr;
    StatusMessageWidget *m_statusMessages = nullptr;
    // Dev/debug HUD - see updateDebugOverlays()/jumpToNextLevel(). Not part
    // of the actual game.
    QLabel *m_positionLabel = nullptr;
    QLabel *m_treasureLabel = nullptr;
    bool m_treasureLabelVisible = false;
    QElapsedTimer m_debugHudClock;
    QString m_currentMapPath; // see jumpToNextLevel()
    bool m_inventoryOpen = false;
    bool m_deathMenuOpen = false;
    bool m_musicEnabled = true;
    QSet<int> m_heldKeys;
};
