#pragma once

#include <QGraphicsView>
#include <QMainWindow>
#include <QSet>

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
    // Blocks (via a local, nested QEventLoop - normal Qt idiom, same
    // family as QDialog::exec()) until `ms` milliseconds pass, keeping the
    // event loop pumping (repaints/input still processed) the whole time -
    // used to hold the loading overlay on screen for a minimum readable
    // duration even though the actual scene construction it's covering is
    // fast enough not to need it.
    void blockFor(int ms);
    // Opens/refreshes the inventory menu and pauses movement/attack while
    // it's up; closing just hides it. See m_inventoryOpen and the
    // isDialogueActive()-style guard in refreshMoveIntent().
    void openInventory();
    void closeInventory();
    // Resets GameState entirely (fresh vars/inventory, no fear of leftover
    // story flags from the run that just ended) and boots the real story
    // entry point again - a genuine full restart, not just a scene reload.
    void respawnFromBeginning();
    // F5/F8 - a single save slot under the user's home directory (see
    // saveFilePath() in the .cpp), not per-chapter or multi-slot. Persists
    // exactly what already survives an ordinary loadLevel() transition
    // (GameState's vars/inventory/level/experience/lastMusicTrack) plus
    // which map to reopen - loading is then just loadLevel(savedMapPath)
    // with that GameState already in place, so it re-runs that chapter's
    // own onLevelStart() the same way returning to an already-visited
    // chapter always has (recruited companions/collected key items/etc.
    // all come back from their *_recruited/*_spawned vars exactly as they
    // would on a normal revisit - nothing new to reconcile). What does
    // NOT round-trip: the player's exact in-level position (resumes at
    // the chapter's own entry point, same as re-entering it fresh) and
    // anything scene-local a chapter script tracks itself outside
    // api.setVar (none currently do).
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
