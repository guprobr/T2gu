#pragma once

#include <QGraphicsView>
#include <QMainWindow>
#include <QSet>

#include <functional>

#include "Character.h"
#include "GameScene.h"
#include "GameState.h"

class DialogueBoxWidget;
class InventoryWidget;
class DeathMenuWidget;
class LoadingOverlayWidget;
class SelectionInfoWidget;
class QResizeEvent;
class QLabel;

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

protected:
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
    // toggled on, the treasure readout current every tick.
    void updateDebugOverlays(QPointF playerPos);
    // Tears down the current GameScene and constructs a new one for
    // `mapPath` - GameState (see GameState.h) survives, everything scene-
    // local does not. Connected to the current scene's
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
    void refreshMoveIntent();
    void repositionDialogueBox();
    void repositionInventoryWidget();
    void repositionDeathMenuWidget();
    void repositionLoadingOverlay();
    // The actual scene swap for loadLevel(), deferred ~1s so the loading
    // overlay stays on screen for a minimum readable duration (scene
    // construction itself is fast enough not to need it otherwise). This
    // used to be a nested QEventLoop (QDialog::exec()-style blocking) run
    // BEFORE the old scene stopped ticking - which meant the old GameScene's
    // 16ms tick timer, and the QJSEngine it drives, could keep firing for
    // that whole second while already several stack frames deep inside a
    // script callback (loadLevel() is very often called FROM a script's
    // api.loadLevel(), i.e. from inside GameScene::onTick() ->
    // ScriptEngine::onTick() -> the JS call itself). A nested event loop at
    // that point can deliver the old tick timer's timeout and reenter the
    // very same QJSEngine call that's still suspended on the C++ stack -
    // this project has already hit real heap corruption from two QJSEngines
    // active at once during a transition (see the old scene's own
    // stopTicking() comment in loadLevel()); a nested event loop here was
    // another route to that exact failure mode, not a safe way to hold the
    // overlay open. Now: the old scene's disconnect()/stopTicking() happen
    // synchronously, immediately, inside loadLevel() itself, and this
    // function - a plain QTimer::singleShot() callback, not a nested loop -
    // does the actual scene replacement once the delay elapses. No event
    // loop is ever entered that Qt wasn't already going to run on its own.
    void finishLoadingLevel(const QString &mapPath);
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

    GameState m_gameState; // persists across loadLevel() calls - owns story vars/inventory
    GameScene *m_scene = nullptr;
    // True from the moment loadLevel() starts a transition until
    // finishLoadingLevel() actually swaps m_scene - guards against a second
    // loadLevel() call (another script race, a dev-key mash) landing mid-
    // transition and stacking a second overlay/timer/scene-swap on top of
    // the first.
    bool m_levelTransitionPending = false;
    // Set by loadGame() right before calling loadLevel(), consumed exactly
    // once by finishLoadingLevel() right after the new scene is constructed
    // - see loadGame()'s own comment for why this replaced capturing
    // `m_scene` right after a (no longer synchronous) loadLevel() call.
    std::function<void()> m_afterNextSceneReady;
    QGraphicsView *m_view = nullptr;
    DialogueBoxWidget *m_dialogueBox = nullptr;
    InventoryWidget *m_inventoryWidget = nullptr;
    DeathMenuWidget *m_deathMenuWidget = nullptr;
    LoadingOverlayWidget *m_loadingOverlay = nullptr;
    SelectionInfoWidget *m_selectionInfoWidget = nullptr;
    // Dev/debug HUD - see updateDebugOverlays()/jumpToNextLevel(). Not part
    // of the actual game.
    QLabel *m_positionLabel = nullptr;
    QLabel *m_treasureLabel = nullptr;
    bool m_treasureLabelVisible = false;
    QString m_currentMapPath; // see jumpToNextLevel()
    bool m_inventoryOpen = false;
    bool m_deathMenuOpen = false;
    QSet<int> m_heldKeys;
};
