#pragma once

#include <QGraphicsPixmapItem>
#include <QPointF>
#include <QRectF>
#include <QString>
#include <QVector>

#include "BlockingGrid.h"
#include "SpriteSheet.h"

class TileMap;
class QGraphicsRectItem;
class QPainter;
class QStyleOptionGraphicsItem;

// A controllable entity on the map. The game may hand control of the input
// to any one Character at a time (the original engine's "party" concept),
// so movement/animation state lives on the entity itself rather than on
// whatever is currently driving it.
//
// The art only has two camera angles per action - facing the camera
// (Front) and facing away (Back) - so vertical movement (up/down) picks
// between those two blocks, while horizontal movement/facing is
// approximated by horizontally mirroring whichever block is current.
class Character : public QGraphicsPixmapItem
{
public:
    explicit Character(SpriteSheet sheet, QGraphicsItem *parent = nullptr);

    // Pixels/second the character should move this frame; (0,0) means idle.
    // Has no effect while a one-shot action (attack/hit/die) is playing -
    // see isActing().
    void setVelocity(QPointF pixelsPerSecond);
    void tick(qreal dtSeconds);

    // Always the full sprite cell, not the (smaller, per-frame) trimmed
    // pixmap actually being drawn - feetOffset(), the shadow, the health
    // bar, the selection marker and the level-up text are all laid out
    // against the cell, and a bounding rect that changed size with every
    // animation frame would move all of them.
    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

    // Which way the soft ground shadow (see paint()) leans, in item-local
    // pixels from feetOffset() - set once by GameScene::createCharacterAt()
    // from the map's ambient lighting mode (see GameScene::m_shadowOffset),
    // so shadows lean away from sunrise/sunset's glow corner instead of
    // always falling straight down. Defaults to a small straight-down lean
    // so a Character never explicitly given one (there's currently no such
    // path, but nothing requires setShadowOffset() to be called) still gets
    // a reasonable-looking shadow rather than none/a centered blob.
    void setShadowOffset(QPointF offset) { m_shadowOffset = offset; }

    // Collision is checked against a single "feet" point rather than the
    // full sprite box - simple, and avoids trees/rocks looking like they
    // block from several tiles away because of the tall sprite above them.
    void setTileMap(const TileMap *map) { m_tileMap = map; }

    // Solid prop footprints (scene coordinates) the character can't walk
    // into, on top of whatever the tile map itself blocks - a shared
    // spatial index (see BlockingGrid.h) owned by whoever built the world
    // (GameScene), not copied per character. Optional: null/unset means
    // "no prop collision", same as never calling setTileMap() means no
    // tile collision.
    void setBlockingAreas(const BlockingGrid *areas) { m_blockingAreas = areas; }

    // Combat participation is opt-in: a Character never called with
    // setMaxHp() (e.g. the showcase-grid roster, which isn't part of combat
    // at all) has no health bar and can't be damaged. Calling it (re)fills
    // current HP to the new max and creates the on-screen bar the first time.
    void setMaxHp(int hp);
    // Overrides current HP after setMaxHp() already ran (which always
    // fills to full) - for restoring a save's exact, possibly-damaged HP
    // without replaying whatever damage caused it. Clamped to [0, maxHp];
    // a no-op if this character was never given combat stats at all. No
    // death/hit animation or sound - a silent state fixup, not a combat
    // event (see applyDamage()/heal() for those).
    void setCurrentHp(int hp);
    int hp() const { return m_hp; }
    int maxHp() const { return m_maxHp; }
    bool isDead() const { return m_dead; }

    // Independent of HP/death - GameScene drives this from the global H-key
    // display mode (hero only / all / none). Safe to call before setMaxHp()
    // ever runs: the preference is just remembered for when the bar is
    // actually created. A dead character's bar stays hidden regardless.
    void setHealthBarVisible(bool visible);

    // True while an attack/hit/die one-shot animation is playing - movement
    // is locked during this window (see tick()), and the caller shouldn't
    // trigger another action until it's done.
    bool isActing() const { return !m_actionMovement.isEmpty(); }

    // Starts the "attack" one-shot if not already dead or mid-action. The
    // caller (GameScene) is responsible for the actual hit-test against
    // targets - this only handles this character's own animation/lockout.
    void triggerAttack();

    // Starts the "skill" one-shot - every generated character sheet has this
    // row (confirmed across the full 135-character roster), reserved for
    // exactly this: a ranged/magic cast, as opposed to "attack"'s melee
    // swing. See GameScene::castFireball(); like triggerAttack(), this only
    // handles the animation/lockout, not the actual projectile or damage.
    void triggerSkill();

    // Dev/debug only (see GameScene::togglePosePreview()) - forces the
    // named row to play immediately, unlike triggerAttack()/triggerSkill()
    // this does NOT check isActing() first, since the preview loop calls it
    // on its own timer to forcibly override whatever the previous previewed
    // row left in progress. Does nothing but change what's displayed - no
    // damage/lockout semantics, and never sets m_dead even for "die".
    void playPreviewAction(const QString &row) { startAction(row); }

    // Reduces HP, clamped at 0, and plays "hit" or (on lethal damage) "die".
    // No-op once already dead. A Character that was never given HP via
    // setMaxHp() can't be damaged (maxHp() stays 0).
    void applyDamage(int amount);

    // Restores HP, clamped at maxHp(). No animation (unlike applyDamage) -
    // this is a menu/item action, not a combat event. No-op once dead or if
    // never given HP via setMaxHp().
    void heal(int amount);

    // Whether `targetFeetPos` is within `reach` pixels of this character's
    // own feet - used by GameScene for both this character's own attacks
    // and as the target check others swing at. A plain circular distance
    // check, deliberately not narrowed to "in front of wherever this
    // character is currently facing": an earlier facing-direction-gated
    // rectangle (only ~104px wide, extending straight out along whichever
    // of the 4 cardinal axes movement last favored) missed any target that
    // was genuinely within the attack range some other AI check had just
    // used to decide "close enough, swing" but sat at enough of a diagonal
    // angle from that one axis - a real, reproducible whiff on a target
    // that visually read as adjacent. Matching this to the same distance
    // metric the "should I even swing" decisions already use (see
    // kEnemyAttackRadius/kPartyAttackRadius in GameScene.cpp) removes that
    // whole mismatch instead of just narrowing it.
    bool isWithinMeleeReach(QPointF targetFeetPos, qreal reach) const;

    // World/scene-coordinate ground-contact point - the same convention
    // Prop's ground anchor uses (see GameScene::placeProp), so comparing a
    // Character's position against a ground-anchored world object (an item
    // pickup, a prop) should use this, not sceneBoundingRect().center() -
    // that's the sprite's visual mid-torso, which sits well above the feet
    // for a tall sprite and would systematically misjudge the distance.
    QPointF feetPos() const { return pos() + feetOffset(); }
    // Y, in this character's own coordinates, where its visible content
    // starts (roughly the top of the head) - the cell's own top edge is
    // hundreds of pixels above that (see SpriteSheet::topFraction()), so
    // anything meant to sit "above the character" anchors here, like the
    // health bar does.
    qreal headTopY() const { return boundingRect().height() * m_sheet.topFraction(); }

    // The roster key this character was spawned as (e.g. "skeleton_archer")
    // - set once by GameScene::createCharacterAt(), the one shared spawn
    // path every character (party/enemy/NPC/sandbox roster) goes through.
    // Used for looking a character up in assets/characters/sounds.json for
    // its whistle/roar; nothing else in Character cares what this is.
    void setName(const QString &name) { m_name = name; }
    QString name() const { return m_name; }

    // A stable portrait for UI (the selection info panel) - always the
    // idle/front/frame-0 pose regardless of whatever this character is
    // actually doing right now, and cropped tightly to its own visible
    // content rather than the full sprite-sheet cell: every cell is
    // bottom-anchored with heavy transparent padding above/around the
    // actual character (see tools/refit_sprites.py), so returning the raw
    // frame would show a tiny character lost in a mostly-empty box once
    // scaled into a small portrait area.
    QPixmap portraitPixmap() const;

    // Whether movement (if any is currently happening - see setVelocity())
    // should play the "run" row instead of "walk" - purely an animation
    // choice, doesn't itself change how far setVelocity() actually moves
    // this character; MainWindow::refreshMoveIntent() is the one place
    // that both raises velocity for Shift and calls this, so the two stay
    // in sync from a single call site rather than this class inferring
    // "running" from velocity magnitude (which the Speed stat already
    // makes vary per character, so a fixed threshold wouldn't work for
    // every character the same way). Every generated character sheet has
    // a "run" row (confirmed across the full roster); updatePixmap() still
    // falls back to "walk" for a hand-added character that somehow
    // doesn't, rather than risk an empty pixmap for a genuinely missing
    // row (see SpriteSheet::frame()).
    void setRunning(bool running) { m_running = running; }
    // See setRunning() - GameScene::updatePartyAI() reads this off the
    // controlled character to decide whether following/chasing party
    // members should also apply a run-speed multiplier.
    bool isRunning() const { return m_running; }

    // Strength/Intelligence/Speed - set once by GameScene::createCharacterAt()
    // from assets/characters/stats.json, looked up by name() the same way
    // the sounds catalog is. Strength scales this character's attack damage
    // (see GameScene::triggerPlayerAttack()/updateEnemyAI()); Speed scales
    // its movement speed (see MainWindow::refreshMoveIntent() for the
    // controlled character, updateEnemyAI() for chase AI); Intelligence is
    // stored for a future magic system and has no effect yet. A Character
    // never given stats (e.g. the showcase-grid roster) reads 0 for all
    // three - callers that turn these into damage/speed treat 0 as "use the
    // pre-stats fallback", not as a literal zero, so nothing already spawned
    // without stats silently breaks.
    void setStats(int strength, int intelligence, int speed)
    {
        m_strength = strength;
        m_intelligence = intelligence;
        m_speed = speed;
    }
    // Added on top of the base stats above once the party reaches level 2+
    // (see GameScene::applyLevelBonusesToParty()) - never called on an
    // enemy/NPC, only on m_party members, so only the player's own party
    // actually grows from leveling up. Kept as separate fields (not folded
    // into m_strength/etc directly) so re-leveling can just recompute and
    // overwrite these rather than needing to remember/undo a previous
    // bonus first.
    void setLevelBonuses(int strength, int intelligence, int speed)
    {
        m_bonusStrength = strength;
        m_bonusIntelligence = intelligence;
        m_bonusSpeed = speed;
    }
    // Permanent, per-item-use stat increases (see GameScene::useItem()'s
    // "permanentBoost" effect type and GameState::itemBonusStrength/etc) -
    // a THIRD bonus channel alongside the level bonuses above, kept
    // separate so a later level-up's setLevelBonuses() call (which always
    // overwrites, not adds) can never wipe these out. Always called with
    // the full accumulated total from GameState, the same "recompute from
    // the authoritative source, don't increment in place" convention
    // setLevelBonuses() already uses.
    void setItemBonuses(int strength, int intelligence)
    {
        m_itemBonusStrength = strength;
        m_itemBonusIntelligence = intelligence;
    }

    // Temporary stat buffs from a consumable (see GameScene::useItem()'s
    // "buff" effect type) - each call REPLACES whatever temporary buff of
    // that same stat was already running rather than stacking with it (so
    // chain-drinking the same potion refreshes the timer instead of
    // compounding without limit); ticks down and clears itself in tick().
    void applyTemporarySpeedBuff(int amount, qreal durationSeconds)
    {
        m_tempBonusSpeed = amount;
        m_tempSpeedRemaining = durationSeconds;
    }
    void applyTemporaryIntelligenceBuff(int amount, qreal durationSeconds)
    {
        m_tempBonusIntelligence = amount;
        m_tempIntelligenceRemaining = durationSeconds;
    }
    void applyTemporaryStrengthBuff(int amount, qreal durationSeconds)
    {
        m_tempBonusStrength = amount;
        m_tempStrengthRemaining = durationSeconds;
    }

    // The "> 0 ? ... : 0" guard preserves the existing "0 means no
    // stats.json entry, use the caller's flat fallback" contract - without
    // it, a hypothetical future character with no catalog entry would
    // start reading a nonzero strength()/etc the moment the party leveled
    // up even though it was never actually given real stats.
    int strength() const { return m_strength > 0 ? m_strength + m_bonusStrength + m_itemBonusStrength + m_tempBonusStrength : 0; }
    int intelligence() const { return m_intelligence > 0 ? m_intelligence + m_bonusIntelligence + m_itemBonusIntelligence + m_tempBonusIntelligence : 0; }
    int speed() const { return m_speed > 0 ? m_speed + m_bonusSpeed + m_tempBonusSpeed : 0; }

    // True at most once per random ~20-45s interval (re-rolled internally
    // each time this returns true) - GameScene checks this every tick for
    // every character and, if true, looks up name() in the sounds catalog
    // to see whether there's actually a whistle sound to play. The random
    // interval lives here (not in GameScene) so each character's timer is
    // independent and 135 characters don't all whistle in lockstep.
    bool consumeWhistlePending();

    // Gentle, coherent idle wandering: a short shuffle in some direction
    // every few seconds, rather than standing perfectly still forever. Off
    // by default; GameScene turns it on only for spawned NPCs (see
    // scriptSpawnNpc()) - deliberately not for party members (one is
    // player-controlled, the rest are waiting to be Tab'd to - wandering
    // off would be actively unhelpful) or enemies (already have their own
    // idle/chase/attack state machine). "Home" is wherever this Character
    // was standing the moment this was first enabled - each short burst of
    // movement (tickIdleWander(), driven from tick()) is a real
    // setVelocity() call using the same movement/collision/animation path
    // as everything else, so a wandering NPC still can't walk through a
    // wall or another blocked tile, and still shows the ordinary walk
    // animation while it moves.
    void setWanderEnabled(bool enabled);

private:
    void updatePixmap();
    void updateHealthBar();
    void ensureHealthBar();
    void startAction(const QString &movement);
    void tickAction(qreal dtSeconds);
    void tickIdleWander(qreal dtSeconds);
    QPointF feetOffset() const;
    bool isBlocked(qreal worldX, qreal worldY) const;

    SpriteSheet m_sheet;
    QPointF m_velocity;
    SpriteSheet::Facing m_facing = SpriteSheet::Facing::Front;
    bool m_mirrorLeft = false;
    bool m_running = false; // see setRunning()
    int m_frame = 0;
    qreal m_frameElapsed = 0.0;
    const TileMap *m_tileMap = nullptr;
    const BlockingGrid *m_blockingAreas = nullptr;

    QString m_actionMovement; // empty = no one-shot playing, see isActing()
    int m_actionFrame = 0;
    qreal m_actionElapsed = 0.0;

    int m_hp = 0;
    int m_maxHp = 0;
    bool m_dead = false;

    QGraphicsRectItem *m_healthBarBg = nullptr;
    QGraphicsRectItem *m_healthBarFill = nullptr;
    qreal m_healthBarFullWidth = 0.0;
    bool m_healthBarVisible = true;

    QString m_name;
    qreal m_whistleCooldown; // seconds remaining - see consumeWhistlePending()

    bool m_wanderEnabled = false;
    bool m_wanderHomeSet = false;
    QPointF m_wanderHome;
    qreal m_wanderCooldown = 0.0; // seconds until the next idle-wander burst
    qreal m_wanderBurstRemaining = 0.0; // seconds left in the current burst, 0 = not wandering right now

    int m_strength = 0;
    int m_intelligence = 0;
    int m_speed = 0;
    int m_bonusStrength = 0;
    int m_bonusIntelligence = 0;
    int m_bonusSpeed = 0;
    int m_itemBonusStrength = 0;     // see setItemBonuses()
    int m_itemBonusIntelligence = 0;
    int m_tempBonusStrength = 0;     // see applyTemporary*Buff() - amount, paired with the
    int m_tempBonusIntelligence = 0; // remaining-seconds fields below; both zero once expired
    int m_tempBonusSpeed = 0;
    qreal m_tempStrengthRemaining = 0.0;
    qreal m_tempIntelligenceRemaining = 0.0;
    qreal m_tempSpeedRemaining = 0.0;

    QPointF m_shadowOffset = QPointF(0, 18); // see setShadowOffset()
};
