#pragma once

#include <QElapsedTimer>
#include <QGraphicsScene>
#include <QHash>
#include <QJsonObject>
#include <QPoint>
#include <QRectF>
#include <QSet>
#include <QStringList>
#include <QTimer>
#include <QVariant>
#include <QVector>

#include "AudioManager.h"
#include "BlockingGrid.h"
#include "Character.h"
#include "GameState.h"
#include "ScriptBridge.h"
#include "ScriptEngine.h"
#include "TileMap.h"

class QGraphicsRectItem;
class QGraphicsSceneMouseEvent;
class LightingOverlayItem;
class Prop;
class TileMapItem;

class GameScene : public QGraphicsScene
{
    Q_OBJECT

public:
    // `state` is owned by MainWindow and outlives this scene - see
    // GameState.h for what persists across a level transition and what
    // doesn't. `mapPath` is resolved by the caller (MainWindow on first
    // boot; this scene itself, via scriptLoadLevel(), for later
    // transitions) - see kDefaultMapPath's old role, now gone from here.
    explicit GameScene(GameState *state, const QString &mapPath, QObject *parent = nullptr);

    Character *controlledCharacter() const;

    // Tile size in world pixels - lets a caller (MainWindow's debug
    // position overlay) convert a raw world position into map (col, row)
    // coordinates the same way GameScene's own tile-based script API does
    // internally (see e.g. useItem()'s "compass" effect).
    int tileWidth() const { return m_map.tileWidth(); }
    int tileHeight() const { return m_map.tileHeight(); }

    // World position of this chapter's own key item (items.json's
    // "keyItem": true, e.g. chapter1's glowing_acorn) - the one that
    // actually gates progress to the next chapter - if it's still out in
    // the world (not yet picked up). Returns false (leaving *outPos
    // untouched) if it's already been collected, or this chapter simply
    // doesn't have one placed right now. Debug/dev use (see MainWindow's Y
    // key), not referenced by any script.
    bool findKeyItemWorldPos(QPointF *outPos) const;

    // Hands input control to the next character in the party, wrapping
    // around. The previously-controlled character is stopped (its own
    // velocity is meaningless once nothing is driving it) - the caller is
    // responsible for re-applying currently-held movement keys to whichever
    // character is controlled now.
    void switchToNextCharacter();

    // Hands input control to whichever character is currently selected
    // (left-click on it first - see mousePressEvent) - the mouse-driven
    // equivalent of switchToNextCharacter, but targeted instead of cyclic.
    // No-op if nothing is selected. Same "stop the outgoing character,
    // caller re-applies held keys" contract as switchToNextCharacter.
    void commandSelectedCharacter();

    // Makes the controlled character swing (its own animation/lockout is
    // handled by Character::triggerAttack()) and applies damage to any
    // living enemy whose sprite box overlaps the resulting melee hit area.
    // No-op if the controlled character is dead or already mid-action.
    void triggerPlayerAttack();

    // Manual fireball cast for the controlled character (F in MainWindow) -
    // see its own comment further down for the full eligibility/cooldown
    // story shared with the automatic AI casting.
    void triggerPlayerFireball();

    // Dev/debug shortcut (F9 in MainWindow) - forces the controlled
    // character straight to 0 HP through the same applyDamage()/"die"
    // animation path a lethal enemy hit would, so death plays out exactly
    // as normal (the death sound, the onPlayerDied script hook,
    // playerDied() showing MainWindow's respawn-from-beginning/quit menu)
    // rather than needing a separate ad hoc "you're dead" path. A
    // character with no combat stats at all (maxHp()==0 - shouldn't
    // happen for whoever the player controls, but nothing enforces it)
    // is given 1 HP first so this can never be a silent no-op.
    void killControlledCharacter();

    // Cycles who shows a health bar: hero only (the starting mode) -> all
    // combat participants -> none -> back to hero only. See H in
    // MainWindow::keyPressEvent.
    void toggleHealthBarDisplay();

    // Dev/debug shortcut (K in MainWindow) - toggles a slow forced loop
    // through every animation row (idle/walk/run/defend/attack/skill/hit/
    // die/dash/jump) on the controlled character, regardless of what would
    // normally trigger each one - hit/die only ever fire from combat, and
    // nothing in any chapter script triggers defend/dash/jump at all. This
    // is the only way to see every pose rendered live through the real
    // SpriteSheet/Character pipeline rather than as a static crop of the
    // sheet file. Driven from onTick(); see isPosePreviewActive(), which
    // MainWindow::refreshMoveIntent() checks to withhold movement input
    // while a preview is running so held WASD keys don't fight it.
    void togglePosePreview();
    bool isPosePreviewActive() const { return m_posePreviewActive; }

    // True while a script's `say()` yield is on screen waiting for the
    // player to advance it - MainWindow checks this to route Enter to
    // advanceDialogue() and to withhold Ctrl's attack while it's up. Also
    // true for an engine-triggered info message (see showInfoMessage()) -
    // as far as MainWindow is concerned it's the same dialogue box either
    // way, just a different source.
    bool isDialogueActive() const;
    void advanceDialogue();
    // Broader than isDialogueActive() - true for the whole time a coroutine
    // is running, dialogue-paused or timer-paused (mid `wait()`).
    bool isScriptBusy() const;

    // The single E-key interact handler (see MainWindow::keyPressEvent).
    // If the controlled character is standing near a spawned NPC, fires
    // that NPC's `onTalkTo(name)` script entry point - same as before this
    // was renamed. Otherwise, if it's standing near a prop, shows that
    // prop's catalog name/description as an engine message (like the
    // compass item - see showInfoMessage()), no scripting required. NPCs
    // are checked first since talking always takes priority over examining
    // scenery. No-op if nobody's in range, or if a dialogue/coroutine is
    // already active (so examining a prop can't clobber an in-progress
    // script conversation, and vice versa).
    void interactWithNearby();

    // A snapshot of one held item, ready for display - see
    // inventoryEntries().
    struct ItemEntry
    {
        QString id;
        QString name;
        QString description;
        QString imagePath;
        int count = 0;
    };
    // Every item currently held in positive count, cross-referenced against
    // assets/items/items.json for display data - built fresh each call
    // (the inventory changes rarely enough that this is cheap, and it
    // avoids a second, cache-invalidation-prone source of truth). See
    // InventoryWidget::refresh().
    QVector<ItemEntry> inventoryEntries() const;

    // A snapshot of whatever's currently selected (see mousePressEvent()),
    // ready for SelectionInfoWidget to display - description is empty for
    // any character (party/enemy/NPC), since none carries lore text the
    // way an item catalog entry does; hasHp/hasLevel say which stat lines
    // actually apply (an NPC with no combat stats has neither, an enemy
    // has HP but no level - only the party shares GameState::level - and
    // an item has neither, just its own description instead).
    struct SelectionInfo
    {
        QPixmap portrait;
        QString name;
        QString description;
        bool hasHp = false;
        int hp = 0;
        int maxHp = 0;
        bool hasLevel = false;
        int level = 0;
    };
    // Activates (and, depending on the item, consumes) one held item - the
    // "press Enter on the selected row" action in the inventory menu.
    // No-op if the item isn't actually held. See items.json's "onUse"/
    // "consumeOnUse" fields and docs/SCRIPTING.md for the full dispatch
    // rules (built-in engine effects vs. the onItemUsed script hook).
    void useItem(const QString &itemId);

    // Full live-scene state for MainWindow's save/load system (F5/F8) -
    // everything GameState's vars/inventory/level/experience don't already
    // cover on their own: exact positions, current HP, and precisely which
    // enemies/NPCs/items are still present (a chapter's own *_spawned
    // guard vars only ever block re-spawning a whole batch outright, they
    // don't track which individual members of that batch are still
    // there - without this, reloading mid-fight would show either the
    // full original batch again or none of it, never "whichever ones I
    // hadn't killed yet"). Dead enemies (see kCorpseLifetimeSeconds) are
    // deliberately excluded - they're already timing out on their own and
    // not meaningful state to restore. `x`/`y` are always the character's
    // raw pos() (or, for an item, the exact worldX/worldY it was placed
    // at) - not feet position - so restoreSnapshot() can hand them
    // straight to setPos()/spawnItemInWorld() with no recomputation.
    struct CharacterSnapshot
    {
        QString name;
        qreal x = 0.0;
        qreal y = 0.0;
        int hp = 0;
        int maxHp = 0;
    };
    struct ItemSnapshot
    {
        QString itemId;
        qreal x = 0.0;
        qreal y = 0.0;
    };
    struct SceneSnapshot
    {
        QVector<CharacterSnapshot> party;
        QString controlledName; // whichever party member is under player control right now
        QVector<CharacterSnapshot> enemies;
        QVector<CharacterSnapshot> npcs;
        QVector<ItemSnapshot> items;
    };
    SceneSnapshot captureSnapshot() const;
    // Repositions/re-HPs the party members onLevelStart() already spawned
    // (matched by roster name - respawnCompanions() already restored
    // exactly the right *set* of companions from GameState, this only
    // fixes up where they stand and how hurt they are) and replaces
    // whatever enemies/NPCs/items are currently present with exactly the
    // saved ones. Meant to run once, right after the freshly-loaded
    // chapter's own onLevelStart has finished (see MainWindow::loadGame()
    // for why that needs a deferred call, not an immediate one) - calling
    // it any earlier would just have its work overwritten or duplicated
    // once onLevelStart actually runs.
    void restoreSnapshot(const SceneSnapshot &snapshot);
    // Shows a message through the same dialogue box a script's say() uses,
    // but engine-triggered rather than script-triggered (e.g. a built-in
    // item effect like the compass) - isDialogueActive()/advanceDialogue()
    // both account for this automatically, so it gets Enter-to-dismiss and
    // the movement lock for free.
    void showInfoMessage(const QString &speaker, const QString &text);

    // Stops the tick timer for good - called by MainWindow right when
    // transitioning away from this scene, before deferring its actual
    // deletion, so it isn't still driving its own ScriptEngine/AI/audio
    // for however long the deferred delete takes to fire.
    void stopTicking();

    // The `api.*` surface a running script actually calls into - see
    // ScriptBridge, which is a thin pass-through to these. Public because
    // ScriptBridge needs to call them, not because anything else should.
    void scriptSpawnCharacter(const QString &name, int tileCol, int tileRow, int hp);
    void scriptSpawnEnemy(const QString &name, int tileCol, int tileRow, int hp);
    // A non-hostile, non-controllable character just standing/idling in the
    // world - a friend/guide to talk to. Never added to m_party or
    // m_enemies, never given a health bar (createCharacterAt only creates
    // one when hp > 0). See interactWithNearby()/onTalkTo.
    void scriptSpawnNpc(const QString &name, int tileCol, int tileRow);
    // Removes a previously-spawned NPC (e.g. once a conversation "recruits"
    // them - see scriptSpawnCharacter - so the same person doesn't stand
    // around twice, once as an NPC and once as a party member). No-op if
    // no NPC with that name exists.
    void scriptDespawnNpc(const QString &name);
    // Also used internally for the map's fixed tree/rock markers - looks up
    // width/blocksMovement in the props catalog, same as every other prop.
    Prop *spawnPropAt(const QString &name, int tileCol, int tileRow);
    // A world pickup - looks up its visual/name in assets/items/items.json.
    // Auto-collected (added to the persistent inventory, removed from the
    // world, fires onItemCollected(id)) once the player walks near it -
    // see onTick(). No key needed, unlike NPCs.
    void scriptSpawnItem(const QString &itemId, int tileCol, int tileRow);
    void scriptSetTileset(const QString &relativePath);
    void scriptSetTile(const QString &tileName, int tileCol, int tileRow);
    // A rectangular, invisible, named movement barrier spanning tileCol/Row
    // to tileCol+tileWidth-1/tileRow+tileHeight-1 inclusive - for gating a
    // path behind a story beat (e.g. "don't let the player reach the forest
    // until they've finished talking to the elder") without needing a
    // visible prop to place and then have no way to remove. `id` names the
    // barrier so a later call with the same id and blocked=false lifts
    // exactly this one, regardless of how many others exist.
    void scriptSetBarrier(const QString &id, int tileCol, int tileRow, int tileWidth, int tileHeight, bool blocked);
    void scriptGiveControl(const QString &name);
    // Generic named story/quest state - a number, string, or bool, whatever
    // a chapter needs (a spawn-once guard, "has met X", an item count...).
    // Replaces an earlier bool-only setFlag/getFlag now that a hundred
    // chapters need more than switches. Backed by GameState, so the
    // underlying value survives a level transition - but the key is
    // namespaced to the current map (see chapterVarKey()), so two chapters
    // using the same name (e.g. both calling something "hostage_rescued")
    // never collide. That used to be a real bug: chapter2.js and
    // chapter4.js both had a "vault_loot_spawned" guard, and reaching
    // chapter4 with it already true from chapter2 meant its loot (including
    // a story-mandatory item) silently never spawned. Use
    // scriptSetGlobalVar/scriptGetGlobalVar instead for the handful of
    // things that must genuinely carry across chapters (companion
    // recruitment, the chapter counter).
    void scriptSetVar(const QString &name, const QVariant &value);
    QVariant scriptGetVar(const QString &name, const QVariant &defaultValue) const;
    // Unnamespaced story/quest state - same storage (GameState::vars) as
    // scriptSetVar/GetVar, just without the current-map key prefix, so the
    // same name reads back the same way from every chapter. For state that
    // must survive not just a level transition but a change of chapter:
    // which companions have been recruited, the chapter counter.
    void scriptSetGlobalVar(const QString &name, const QVariant &value);
    QVariant scriptGetGlobalVar(const QString &name, const QVariant &defaultValue) const;
    // The persistent inventory (GameState::inventory) - a simple id->count
    // map, no weight/slots/equipping. Also survives a level transition.
    void scriptGiveItem(const QString &itemId, int count);
    void scriptRemoveItem(const QString &itemId, int count);
    int scriptGetItemCount(const QString &itemId) const;
    bool scriptHasItem(const QString &itemId) const;
    // Adds to the party's shared level/XP (see GameState::level/experience)
    // and, if that crosses one or more level-up thresholds, raises every
    // current party member's Strength/Intelligence/Speed (see
    // applyLevelBonusesToParty()) and shows the "Level Up!" effect once
    // (never once per level, even if a big award crosses several
    // thresholds at once). Also called internally, without any script
    // involvement, when an enemy is defeated (see triggerPlayerAttack()) or
    // a keyItem is picked up (see updateItemPickups()) - a script only
    // needs this directly for narrative-driven awards like rescuing
    // someone (see docs/SCRIPTING.md).
    void scriptGiveExperience(int amount);
    void scriptPlaySound(const QString &name);
    void scriptPlayMusic(const QString &name, bool loop);
    void scriptStopMusic();
    // Tears down this scene and hands control to a new GameScene for the
    // named map (path resolved relative to this scene's own map file, same
    // convention as setTileset/the "script" field) - see
    // MainWindow::loadLevel(), connected to levelChangeRequested below.
    // GameState (vars/inventory) survives; everything else about this
    // scene (party, enemies, NPCs, items, the map itself) does not - the
    // new map's own script is responsible for spawning whatever it wants
    // present.
    void scriptLoadLevel(const QString &relativePath);

signals:
    // Emitted each tick so the view can keep the camera centered on the
    // controlled character - the scene owns the tick loop, the view (owned
    // by MainWindow) owns the camera, so this is how the two stay in sync.
    void controlledCharacterMoved(QPointF scenePos);

    // Proxied straight through from m_scriptEngine (see its own signals) -
    // MainWindow only ever talks to GameScene, never reaches into the
    // script engine directly, same as every other subsystem here.
    void dialogueRequested(QString speaker, QString text);
    void dialogueEnded();

    // See scriptLoadLevel() - `absoluteMapPath` is already fully resolved.
    void levelChangeRequested(QString absoluteMapPath);

    // The controlled character's HP just hit 0 - emitted once, right next
    // to the existing onPlayerDied() script-hook dispatch (guarded by the
    // same m_playerDeathNotified latch). MainWindow shows the respawn/quit
    // menu in response; the script hook and this signal both fire, neither
    // replaces the other.
    void playerDied();

    // See mousePressEvent() - left-clicking a party member, enemy, NPC, or
    // world item selects it (selectionChanged); clicking empty ground, a
    // decorative prop, or the already-selected thing again deselects
    // (selectionCleared). Also fires selectionCleared if the selected
    // thing is removed out from under the selection (an enemy's corpse
    // expiring, an NPC being despawned, an item being picked up).
    void selectionChanged(const GameScene::SelectionInfo &info);
    void selectionCleared();

protected:
    void mousePressEvent(QGraphicsSceneMouseEvent *event) override;

private slots:
    void onTick();

private:
    // A hostile Character plus its own small amount of AI state. AI has no
    // real "state machine" - each tick it just reacts to the current
    // distance to the controlled character (idle / chase / attack), which
    // is simple enough not to need one.
    struct Enemy
    {
        Character *character = nullptr;
        QString name; // the roster key, e.g. "skeleton_swordsman" - for onEnemyDefeated(name)
        qreal attackCooldownRemaining = 0.0;
        bool scriptNotified = false; // guards onEnemyDefeated firing more than once
        // Seconds until this corpse's item is removed from the scene - set
        // once, in awardEnemyDefeatRewards(), the moment this enemy dies;
        // -1 means "still alive, not counting down". See kCorpseLifetimeSeconds.
        qreal corpseTimeRemaining = -1.0;
    };

    struct Npc
    {
        Character *character = nullptr;
        QString name; // the roster key - for onTalkTo(name)
    };

    // A world pickup - see scriptSpawnItem()/onTick()'s pickup check.
    struct WorldItem
    {
        Prop *prop = nullptr;
        QString itemId;
        qreal worldX = 0.0;
        qreal worldY = 0.0;
    };

    // beforeEntityDestroyed() cancels hits against a removed target; this
    // pointer's lifetime must not depend on flight time or corpse timing.
    struct PendingFireballHit
    {
        qreal timeRemaining = 0.0;
        Character *target = nullptr;
        bool targetIsEnemy = false; // which side awardEnemyDefeatRewards() should look it up on, if it dies
        int damage = 0;
    };

    // A following/chasing party member's current grid path - see
    // findPath()/updatePartyAI(). Recomputed only occasionally (throttled
    // by repathCooldown, and only when the target has actually moved
    // meaningfully) rather than every tick, since a fresh BFS is overkill
    // for a target that's barely shifted since the last one.
    struct PartyPath
    {
        QVector<QPointF> waypoints; // remaining stops, front() is the next one to reach
        QPointF targetWorld;        // where this path was aimed - triggers a repath once stale
        qreal repathCooldown = 0.0;
        // Stuck detection: a grid path is only walkable in the coarse,
        // tile-center sense findPath() checks - real continuous collision
        // can still wedge a character on a corner the grid didn't catch
        // (e.g. right at a wall edge between two nominally-open tiles).
        // If distance to the current waypoint stops shrinking for a while,
        // moveAlongPath() throws the path away and forces an immediate
        // repath rather than leaving the character parked against
        // whatever it hit.
        qreal lastWaypointDistance = -1.0; // -1 = no reading yet
        qreal stuckTimer = 0.0;

        // Trail-follow state (see followTrail()). While > 0 the trail is
        // ignored and the grid path above is used instead - set when no
        // trail point is reachable from here (the follower is off the
        // trail) or when trail steering stopped making progress.
        qreal trailSuppressSeconds = 0.0;
        QPointF trailProgressAnchor; // where trail steering last measured progress from
        qreal trailStuckTimer = 0.0;

        // Crowd shuffle state (see shuffleInCrowd()), used only while the
        // leader is standing still. shuffleTimer is the remaining walk time
        // toward shuffleTarget, or the remaining pause once there.
        bool hasShuffleTarget = false;
        QPointF shuffleTarget;
        qreal shuffleTimer = 0.0;
    };

    enum class HealthBarDisplay { HeroOnly, All, None };

    // Picks the actual level music once the entrance's ambient intro (see
    // the constructor) finishes - an arbitrary track, but never the same
    // one that was just playing, so "alternate" reads as "keep it varied,"
    // not "let it sometimes repeat by chance."
    void playRandomLevelTrack();
    // Selects `target` (a party/enemy/NPC Character, or an item pickup's
    // Prop) and shows its info panel - unless `target` is already the
    // current selection, in which case this deselects instead (the
    // "clicking the same object again" half of the toggle - see
    // mousePressEvent()). `partyIndex` is the index into m_party if
    // `target` is the controlled character's party (for
    // commandSelectedCharacter()'s sake), or -1 for anything else.
    void trySelect(QGraphicsItem *target, const SelectionInfo &info, int partyIndex);
    // Clears the current selection (info panel hidden, marker hidden) -
    // the "clicking empty ground / a decorative prop" half of the toggle.
    // No-op if nothing is selected.
    void deselectCurrent();
    // All individual enemy/NPC/pickup deletions go through this path after
    // removal from their population container. Qt owns the entity's child
    // items; beforeEntityDestroyed drops every remaining external pointer.
    void destroyEntity(QGraphicsItem *entity);
    void beforeEntityDestroyed(QGraphicsItem *entity);
    SelectionInfo selectionInfoForCharacter(Character *character) const;
    SelectionInfo selectionInfoForItem(const WorldItem &item) const;
    void spawnEnemies();
    // Shared tail of "the controlled character just reached 0 HP" -
    // fires onPlayerDied/the funeral bell/playerDied() exactly once (see
    // m_playerDeathNotified), regardless of whether the killing blow came
    // from an enemy's own attack or killControlledCharacter()'s debug
    // shortcut.
    void notifyPlayerDeathIfNeeded();
    void updateEnemyAI(qreal dtSeconds);
    // Drives every party member except the currently-controlled one: fight
    // the nearest enemy within kPartyEngageRadius if there is one, otherwise
    // follow the controlled character at a staggered formation offset so
    // companions stay nearby without stacking on the exact same pixel.
    void updatePartyAI(qreal dtSeconds);
    // Shared tail of a successful killing blow - awards XP, drops loot, and
    // fires onEnemyDefeated() exactly once (guarded by enemy.scriptNotified).
    // Used by both the player's own attack and updatePartyAI()'s combat AI.
    void awardEnemyDefeatRewards(Enemy &enemy);
    // Counts down corpseTimeRemaining for every dead enemy and removes/
    // deletes its item once expired - see kCorpseLifetimeSeconds for why.
    void updateCorpseCleanup(qreal dtSeconds);
    // Sets character's velocity to move it one step along a grid path
    // toward targetWorld, computing/refreshing that path in pathState as
    // needed (see PartyPath) - the fix for straight-line follow/chase
    // movement getting stuck on maze walls. Falls back to a direct straight
    // line toward targetWorld if no path could be found (e.g. the target is
    // genuinely unreachable, or the search exceeded its node cap) so a
    // companion still tries something rather than freezing outright.
    void moveAlongPath(Character *character, PartyPath &pathState, QPointF targetWorld, qreal speed, qreal dtSeconds);
    // Records the controlled character's route (m_leaderTrail) and how long
    // it has been standing still (m_leaderStillSeconds). Starts a fresh
    // trail whenever the leader changes or jumps (level load, snapshot
    // restore, script teleport) - the old route no longer leads anywhere.
    void updateLeaderTrail(Character *leader, qreal dtSeconds);
    // Drives a following party member along the leader's trail to the spot
    // `arc` pixels of trail behind the leader, instead of pathfinding to it.
    // Every trail point is a spot the leader really stood on and collision
    // is a single feet-point test shared by every character, so walking
    // the trail can't wedge the way a tile-center grid path can. Returns
    // true if the follower is already close enough to that spot to hold
    // (velocity set to zero), false if it's still moving. Falls back to
    // moveAlongPath() (A*) when no trail point is reachable from here.
    bool followTrail(Character *character, PartyPath &pathState, QPointF leaderFeet, qreal arc, qreal speed, qreal dtSeconds);
    // Finds the point `arc` pixels back along m_leaderTrail from the
    // leader's live position, and the trail index just older than it (-1 if
    // there's none). A trail shorter than `arc` yields its oldest point.
    QPointF trailPointAtArc(QPointF leaderFeet, qreal arc, int &olderIndex) const;
    // Whether the straight line between two points crosses only walkable
    // ground (tile walkability + m_blockingAreas, sampled every few pixels
    // - the same feet-point test real movement uses).
    bool isSegmentWalkable(QPointF from, QPointF to) const;
    // While the leader stands still, a follower already near it idles in
    // a loose crowd instead of a line: it picks a short random step
    // that keeps kPartyCrowdSpacingX/Y clear of every other member (on
    // either axis is enough - see violatesCrowdSpacing()), walks it slowly,
    // pauses, and repeats. A follower found overlapping someone re-picks
    // immediately.
    void shuffleInCrowd(Character *character, PartyPath &pathState, QPointF leaderFeet, qreal dtSeconds);
    // True if `point` would sit inside another live party member's spacing
    // box - closer than kPartyCrowdSpacingX horizontally AND
    // kPartyCrowdSpacingY vertically at once. `self` is skipped;
    // includeShuffleTargets also counts the spots other members are
    // currently walking to, so two of them don't pick the same one.
    bool violatesCrowdSpacing(QPointF point, const Character *self, bool includeShuffleTargets) const;
    // Grid BFS (4-directional, no diagonals - this engine's mazes are
    // grid-aligned corridors, so diagonal shortcuts would just cut through
    // wall corners) from fromWorld to toWorld, walkability tested the same
    // way Character::isBlocked() resolves real movement collision (tile
    // walkability + m_blockingAreas) - just inlined here against m_map/
    // m_blockingAreas directly rather than through a Character instance,
    // since that check is private to Character and every character shares
    // the same map/blocking state anyway. Returns an empty vector if no
    // path was found within kPathfindMaxExpansions node expansions (see
    // GameScene.cpp) - a safety cap, not a hard map-size limit, so this
    // can't stall a tick on a huge unreachable search.
    QVector<QPointF> findPath(QPointF fromWorld, QPointF toWorld) const;
    void applyHealthBarDisplay();
    void updateItemPickups();
    // Shared tail of scriptSpawnItem()/dropRandomLoot() - places itemId's
    // visual at an exact world position rather than a tile (a dropped-loot
    // position is wherever the enemy died, not necessarily tile-centered).
    void spawnItemInWorld(const QString &itemId, qreal worldX, qreal worldY);
    // Resolves an items.json catalog entry's icon path - "image" preferred,
    // "prop" as the older placeholder fallback. Shared by spawnItemInWorld()
    // and inventoryEntries().
    QString itemImagePath(const QJsonObject &catalogEntry) const;
    // Looks characterName up in m_creatureSoundsCatalog for a `kind`
    // ("whistle" or "roar") sound and plays it if found. "roar" falls back
    // to the shared "attack" sfx when a character has no roar of its own;
    // "whistle" has no fallback - plays nothing rather than something
    // generic, per the spec (most characters simply don't whistle at all).
    void playCreatureSound(const QString &characterName, const QString &kind);
    // Rolls kEnemyLootDropChance and, on success, drops one random item from
    // m_lootPool (every catalog item NOT marked "keyItem") at worldX/worldY.
    // Called once per enemy death, right where onEnemyDefeated fires.
    void dropRandomLoot(qreal worldX, qreal worldY);
    // Core of scriptGiveExperience() - shared by that and the two internal
    // (kill/keyItem) award sites so all three go through identical
    // level-up logic.
    void awardExperience(int amount);
    // Recomputes Strength/Intelligence/Speed bonuses from m_state->level
    // (see the kLevel*GrowthPerLevel/kMaxSpeedBonus constants in
    // GameScene.cpp) and applies them to every current m_party member -
    // called after a level-up, and also right after a new party member is
    // spawned (scriptSpawnCharacter()) so a freshly recruited companion
    // starts with the party's current bonuses instead of sitting at base
    // stats until the next level-up.
    void applyLevelBonusesToParty();
    // Spawns a transient LevelUpTextItem above the controlled character.
    // No-op if nobody is currently controlled (shouldn't normally happen,
    // but a script could conceivably await XP before giveControl()).
    void showLevelUpEffect();

    // The magic system: once a Character's intelligence() reaches
    // kFireballMinIntelligence (see GameScene.cpp - most of the roster
    // falls well short; it's mainly the mage/spirit/undead-caster
    // archetypes, both party and hostile, that clear it), they periodically
    // fling a fireball at the nearest valid target in range, fully
    // automatically - the same "a passive trait of the character, not a
    // manually-triggered action" convention non-controlled party members'
    // melee AI already uses. Runs AFTER updatePartyAI()/updateEnemyAI() in
    // onTick() so a character already mid-melee-swing this tick (isActing())
    // never also casts the same tick - melee gets first refusal, and a
    // caster only ever throws a fireball on a tick it didn't just swing.
    void updateFireballCasting(qreal dtSeconds);
    // Nearest living Enemy within `maxRange` of `fromFeet`, or null - shared
    // by updateFireballCasting()'s party-caster loop and
    // triggerPlayerFireball() so both pick a target the exact same way.
    Enemy *nearestLivingEnemyInRange(QPointF fromFeet, qreal maxRange);
    // Starts one fireball: the caster's "skill" animation, a purely-visual
    // FireballItem traveling from caster to target, and a PendingFireballHit
    // entry so the actual damage lands (deterministically, on GameScene's
    // own tick) exactly when the visual arrives.
    void castFireball(Character *caster, Character *target, bool targetIsEnemy);
    // Ticks down every in-flight fireball's PendingFireballHit and applies
    // damage once each one's travel time elapses - see castFireball().
    void updatePendingFireballHits(qreal dtSeconds);
    // Rings the map's outer tile perimeter with props so it reads as having
    // a horizon (exterior) or enclosing walls (interior) instead of just
    // stopping - see assets/props/borders.json/walls.json. `mapRoot` is the
    // already-parsed map JSON (read once in the constructor); a map with no
    // matching entry in the relevant catalog is a silent no-op, and
    // sandbox.json is never passed here (it hand-builds its own border).
    void decorateMapEdges(const QJsonObject &mapRoot);

    // Namespaces a script var name to the current map, so
    // scriptSetVar/GetVar can't collide across chapters (see their own
    // comments). Just the map's filename (e.g. "chapter4.json"), matching
    // the portable identity saveGame() already stores for the map itself -
    // not the full m_mapPath, which is install-specific.
    QString chapterVarKey(const QString &name) const;

    // Shared by the constructor's roster/enemy setup AND scriptSpawnCharacter/
    // scriptSpawnEnemy, so a scripted spawn behaves identically to a
    // hardcoded one instead of the two silently drifting apart. Returns
    // nullptr (and logs) if the named character's sprite sheet is missing.
    Character *createCharacterAt(const QString &name, int tileCol, int tileRow, int hp);
    // createCharacterAt()'s actual body, taking a raw world feet position
    // instead of tile coordinates - createCharacterAt() is now a thin
    // tile-to-world wrapper around this. restoreSnapshot() calls this
    // directly with resolveCollision=false to place a restored character
    // at its exact saved position rather than a tile center.
    Character *createCharacterAtWorldFeet(const QString &name, QPointF worldFeetPos, int hp, bool resolveCollision);
    // Shared tail of every prop placement (showcase grid, markers,
    // spawnPropAt): position by ground-contact point, Y-sort, register as a
    // solid blocker if applicable.
    void placeProp(Prop *prop, qreal worldGroundX, qreal worldGroundY, bool blocksMovement);

    GameState *m_state; // owned by MainWindow, outlives this scene - see GameState.h
    QString m_mapPath; // this scene's own map file, for resolving relative script/tileset/loadLevel paths

    TileMap m_map;
    // Both owned by the scene (QGraphicsScene::addItem() takes ownership),
    // kept here only so onTick() can drive their animation - see
    // TileMapItem::tick()/LightingOverlayItem::tick(). m_lightingOverlayItem
    // stays null for a map with no (or an unrecognized) "lighting" mode.
    TileMapItem *m_tileMapItem = nullptr;
    LightingOverlayItem *m_lightingOverlayItem = nullptr;
    QVector<Character *> m_party;
    // Attack cooldown for updatePartyAI()'s combat AI, per non-controlled
    // party member - a QHash keyed by pointer rather than a field on
    // Character itself (mirrors Enemy::attackCooldownRemaining, but m_party
    // is a plain QVector<Character *> with no equivalent wrapper struct to
    // hang it off). Absent entries default-construct to 0.0 (ready to
    // attack immediately), same as a fresh Enemy's own cooldown starts at 0.
    QHash<Character *, qreal> m_partyAttackCooldowns;
    // Fireball cooldown for updateFireballCasting(), covering EVERY caster
    // (party AND enemies) in one shared map - unlike melee, which needs
    // separate per-side bookkeeping (Enemy::attackCooldownRemaining vs.
    // m_partyAttackCooldowns) because the two AI loops are otherwise
    // completely separate, fireball casting is one unified routine that
    // already treats both sides identically, so one map covers both.
    QHash<Character *, qreal> m_fireballCooldowns;
    // Per-follower grid path for updatePartyAI() - see PartyPath/findPath().
    QHash<Character *, PartyPath> m_partyPaths;
    // The controlled character's recent route, oldest sample first - see
    // updateLeaderTrail()/followTrail(). Never dereferenced through
    // m_trailLeader, only compared, but destroyEntity() still clears it so
    // a recycled address can't be mistaken for the same leader.
    QVector<QPointF> m_leaderTrail;
    Character *m_trailLeader = nullptr;
    QPointF m_lastLeaderFeet;
    qreal m_leaderStillSeconds = 0.0;
    // Cells findPath() should treat as impassable a bit longer than the
    // map's own static data says, keyed by tile cell with seconds
    // remaining (decremented/pruned once per tick in onTick()). Populated
    // by moveAlongPath() when a follower's stuck-recovery repath (see
    // PartyPath::stuckTimer) lands on the exact same waypoint as before -
    // proof the tile-center-only grid findPath() searches over doesn't
    // agree with the continuous collision Character::isBlocked() actually
    // enforces there (a prop whose footprint doesn't cover the tile's own
    // center, say), so simply repathing again would just find the same
    // "valid" route into the same wedge. Blacklisting that one cell for a
    // few seconds forces the next repath to detour around it instead.
    QHash<QPoint, qreal> m_temporarilyBlockedCells;
    QVector<Enemy> m_enemies;
    QVector<PendingFireballHit> m_pendingFireballHits; // see castFireball()/updatePendingFireballHits()
    QVector<Npc> m_npcs; // see scriptSpawnNpc()/interactWithNearby()
    QVector<WorldItem> m_worldItems; // see scriptSpawnItem()/updateItemPickups()
    QHash<QString, Character *> m_charactersByName; // for scriptGiveControl() and interactWithNearby()
    QVector<Prop *> m_props; // every spawned prop (name set via Prop::setName) - see spawnPropAt()/interactWithNearby()
    // Persistent spatial-hash occupancy for resolveSpawnCollision() - see
    // its own comment for why these are kept across every spawn rather
    // than rebuilt from m_party/m_enemies/m_npcs or m_props/m_worldItems
    // each time. Separate sets since a character standing where a prop's
    // ground anchor sits (extremely common - most props are walked past or
    // stood next to) is normal and shouldn't nudge either one.
    QSet<qint64> m_occupiedCharacterCells;
    QSet<qint64> m_occupiedPropCells;
    QJsonObject m_propsCatalog; // "props" object from props.json, kept around for spawnPropAt()
    QJsonObject m_itemsCatalog; // "items" object from items.json, kept around for scriptSpawnItem()
    QStringList m_lootPool; // every non-keyItem catalog id - see dropRandomLoot()
    QJsonObject m_creatureSoundsCatalog; // "sounds" object from characters/sounds.json - see playCreatureSound()
    QJsonObject m_statsCatalog; // "stats" object from characters/stats.json - see createCharacterAt()
    // Derived once from the map's "lighting" field (see shadowOffsetForLighting()
    // in GameScene.cpp) and handed to every Character/Prop as they're spawned
    // (createCharacterAt()/spawnPropAt()) so ground shadows lean away from
    // whichever corner sunrise/sunset glows from, or fall straight down for
    // every other lighting mode (or none at all).
    QPointF m_shadowOffset = QPointF(0, 18);
    // Solid prop footprints (scene coords) gathered while props load - shared
    // by every party character (see Character::setBlockingAreas). Stored on
    // the scene rather than per-character since it's the same set for all of
    // them. A spatial hash (see BlockingGrid.h), not a flat list - a linear
    // scan over every prop's footprint on every moving character's every
    // movement step was fine at a "handful" of props, but became the
    // dominant per-frame cost once map prop counts reached the thousands.
    BlockingGrid m_blockingAreas;
    QHash<QString, QRectF> m_namedBarriers; // see scriptSetBarrier() - lets a story-gate barrier be lifted later by id
    // See togglePosePreview()/isPosePreviewActive(). m_posePreviewRowIndex
    // indexes into the row list defined alongside togglePosePreview()'s
    // implementation; -1 while inactive.
    bool m_posePreviewActive = false;
    int m_posePreviewRowIndex = -1;
    qreal m_posePreviewElapsed = 0.0;
    int m_controlledIndex = 0;
    // -1 unless the current selection (see m_selectedItem) is a party
    // member - commandSelectedCharacter()'s own index into m_party.
    int m_selectedIndex = -1;
    // The actual selected QGraphicsItem (a Character* for a party member/
    // enemy/NPC, or a Prop* for a world item) - nullptr when nothing is
    // selected. Compared against on every click to decide "select this
    // new thing" vs "clicking the current selection again, deselect."
    QGraphicsItem *m_selectedItem = nullptr;
    bool m_playerDeathNotified = false; // guards onPlayerDied firing more than once
    bool m_engineMessageActive = false; // see showInfoMessage() - an engine-triggered dialogue box, not a script one
    HealthBarDisplay m_healthBarDisplay = HealthBarDisplay::HeroOnly;
    QGraphicsRectItem *m_selectionMarker = nullptr;
    QTimer m_tickTimer;
    QElapsedTimer m_clock;
    qint64 m_lastElapsedMs = 0;
    AudioManager m_audio;

    // Declaration order matters here: the bridge must exist before the
    // engine, which installs it as the script-global `api` object.
    ScriptBridge m_scriptBridge{ this };
    ScriptEngine m_scriptEngine{ &m_scriptBridge };
};
