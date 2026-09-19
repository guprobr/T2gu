#include "GameScene.h"

#include <QDebug>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGraphicsRectItem>
#include <QGraphicsSceneMouseEvent>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPen>
#include <QRandomGenerator>
#include <QSet>
#include <algorithm>
#include <cmath>
#include <queue>
#include <utility>
#include <vector>

#include "FireballItem.h"
#include "LevelUpTextItem.h"
#include "LightingOverlayItem.h"
#include "Prop.h"
#include "TileMapItem.h"

namespace {
constexpr int kTickIntervalMs = 16; // ~60Hz
// Caps the per-tick delta time fed into movement integration. Character::
// tick() moves by `velocity * dt` and only checks collision at the
// resulting final position - correct and cheap at a normal ~16ms dt, but
// if any single tick's *wall-clock* gap spikes (a GC pause, the OS
// scheduling this process out for a moment, a slow frame for any reason),
// the raw dt reflects that entire gap, and a fast-enough character can
// move further in that one step than a wall is thick - "tunneling"
// straight through it, since the only checked point is the far side.
// Clamping dt bounds the worst-case single-tick displacement regardless
// of how long the real-world gap was; the simulation just quietly treats
// a stalled interval as one slightly-longer-than-usual tick instead of
// integrating the full, potentially huge, elapsed time in one jump. This
// is what "the player starts to walk through solid [...] during that
// period" was actually caused by - a genuine stutter existing at all
// doesn't have to mean movement breaks, if the step size it produces stays
// bounded.
constexpr qreal kMaxTickDtSeconds = 0.05; // ~3 nominal ticks' worth

// Loading a sprite sheet means reading+parsing its JSON sidecar and
// decoding its PNG from disk (see SpriteSheet::load()) - fine for a
// handful of characters, but a real cost once a single chapter spawns the
// same roster name many times (e.g. several "orc" enemies) or the same
// companion is re-spawned on every level transition. Process-lifetime
// cache keyed by roster name, checked in createCharacterAt() below -
// copying an already-loaded SpriteSheet is cheap (its QPixmap and internal
// per-frame QHash cache are both implicitly shared), so a cache hit avoids
// the disk I/O entirely instead of just deferring it.
QHash<QString, SpriteSheet> &spriteSheetCache()
{
    static QHash<QString, SpriteSheet> cache;
    return cache;
}

// "skeleton_swordsman" -> "Skeleton Swordsman" - there's no separate
// display-name data for a character anywhere (dialogue speaker names like
// "Lara"/"Vigil" only ever exist as literal strings inside chapter
// scripts, never tied back to a roster key), so the selection info panel
// falls back to a title-cased version of the roster key itself rather
// than showing the raw underscored key verbatim.
QString prettifyRosterName(const QString &rosterKey)
{
    QStringList words = rosterKey.split(QLatin1Char('_'), Qt::SkipEmptyParts);
    for (QString &word : words) {
        if (!word.isEmpty())
            word[0] = word[0].toUpper();
    }
    return words.join(QLatin1Char(' '));
}

// Cell key for a simple spatial hash used by resolveSpawnCollision() below -
// same bucketing idea as BlockingGrid.h, sized to the "is this the exact
// same coordinate" threshold rather than typical object size, since that's
// all this needs to answer.
constexpr qreal kCollisionCellSize = 8.0; // world px
qint64 collisionCellKey(QPointF pos)
{
    const qint64 cx = static_cast<qint64>(std::floor(pos.x() / kCollisionCellSize));
    const qint64 cy = static_cast<qint64>(std::floor(pos.y() / kCollisionCellSize));
    return (cx << 32) ^ static_cast<quint32>(cy);
}

// Nudges `pos` away until its cell isn't already marked occupied in
// `occupiedCells`, then marks the resolved cell occupied - see
// createCharacterAt()/placeProp() for why: whatever the cause (a scripted
// overlap, or a genuine spawn-logic bug), two objects sharing one
// coordinate are visually indistinguishable from a single object and stay
// that way forever, since nothing else ever nudges them apart
// independently. A small, fixed step in a consistent direction, repeated
// until clear, is enough to make "there are actually two of these"
// immediately visible without needing to know why there are two - and
// doubles as a general no-two-objects-stack rule for playability.
//
// occupiedCells is a persistent set the caller keeps across every spawn in
// the scene, not something rebuilt from the current object list each call -
// with maps running to several thousand props, re-scanning every existing
// object on every single placement turned a one-time O(n) map load into an
// O(n^2) one (measured: chapter6's onLevelStart went from well under a
// second to ~7.8s over its ~7000 props). A cell only ever occupied by an
// object that's since been removed (a despawned NPC, say) stays marked -
// slightly over-cautious, but cheap and never wrong in the direction that
// matters (it would at most nudge a future spawn that didn't strictly need
// it, never fail to nudge one that did).
QPointF resolveSpawnCollision(QPointF pos, QSet<qint64> &occupiedCells)
{
    constexpr qreal kCollisionNudgeStep = 48.0; // world px per nudge
    constexpr int kMaxNudges = 64; // far more than any real spawn cluster needs
    for (int guard = 0; guard < kMaxNudges && occupiedCells.contains(collisionCellKey(pos)); ++guard)
        pos += QPointF(kCollisionNudgeStep, kCollisionNudgeStep);
    occupiedCells.insert(collisionCellKey(pos));
    return pos;
}

// placeProp() Y-sorts every prop by its own ground-contact Y (see its own
// comment) - correct for typical scenery, but it silently assumes a
// sprite's visual extent roughly matches its own anchor tile. A large
// set-piece prop (a big tree's canopy, a cliff face) can visually reach
// well past that, and an item pickup placed on a nearby *open* maze cell -
// never the same tile, but close enough for the two sprites to overlap on
// screen - could end up with a smaller Y (further "north") than that
// prop's own anchor while still sitting inside its drawn silhouette,
// making the prop paint over it and the item vanish entirely: exactly the
// "walked right past it and never saw it" report, for the maze's own key
// item among others. Comfortably above the highest zValue() any regular
// prop/character can reach (bounded by worldGroundY, itself bounded by
// mapHeight * tileHeight - a five-figure number at most across every
// existing map), so an item pickup's own zValue() += this guarantees it
// always draws on top of ordinary scenery instead of relying on precise
// Y-sort math that a big prop's own art can already violate.
constexpr qreal kItemZBoost = 1'000'000.0;

constexpr int kEnemyHp = 40;
// All world-pixel distance/speed constants in this file were doubled
// together with the 2x asset scale (see tools/upscale_2x.py and this
// session's plan) - "1 world unit" now corresponds to twice the rendered
// pixels, so a stale, un-doubled distance would silently read as half its
// intended size/reach relative to the new, bigger tiles and characters.
// Anything that's a ratio/multiplier rather than a distance (kRunSpeed-
// Multiplier and friends) or time-based (cooldowns/intervals) was left
// alone - see the plan for the full accounting of what did and didn't
// need to change.
constexpr qreal kEnemyChaseSpeed = 180.0;    // px/s - fallback for a character with no stats.json entry

// Speed scales movement: speed (stat) * kSpeedStatToPixelsPerSecond. Kept
// in sync by convention (not by sharing a header) with the identical
// constant in MainWindow.cpp's refreshMoveIntent() - both are "how many
// px/s does one point of Speed buy", the same physical thing whether the
// character in question is currently player-controlled or AI-chasing.
constexpr qreal kSpeedStatToPixelsPerSecond = 32.0;
qreal moveSpeedFor(int speed, qreal fallbackSpeed)
{
    return speed > 0 ? speed * kSpeedStatToPixelsPerSecond : fallbackSpeed;
}
constexpr qreal kEnemyDetectRadius = 440.0; // px - starts chasing once the player is this close
// kEnemyAttackRadius (the AI's "close enough, stop and swing" decision) used
// to be LARGER than kEnemyAttackReach (the actual hit-detection distance
// Character::isWithinMeleeReach() checks against, in the exact same tick) -
// 100 vs 80. Any swing triggered from 80-100px away was a real, unavoidable
// whiff: the enemy visibly plays its attack animation right next to the
// player and the hit never lands, since a check against 80px can't reach a
// target the radius check just approved at up to 100px. Reach must always
// be >= radius (with real margin, not just barely equal) so every attack
// the AI decides to throw is geometrically guaranteed to land if the target
// hasn't moved. See the identical kPartyAttackRadius/kPartyAttackReach pair
// below - same bug, same fix.
//
// A second, separate whiff source lived in the hit-test itself:
// isWithinMeleeReach() used to be meleeHitArea(), a ~104px-wide rectangle
// extending only along whichever single cardinal axis (up/down/left/right)
// the attacker's last movement favored. A target sitting diagonally -
// genuinely within the radius check above, just not aligned with that one
// axis - fell outside the rectangle's narrow perpendicular band and still
// whiffed, even with reach comfortably >= radius. isWithinMeleeReach() is a
// plain circular distance check instead, matching the same distance metric
// the radius decisions already use, so nothing here can approve a swing the
// hit-test then geometrically can't land.
constexpr qreal kEnemyAttackRadius = 110.0; // px - stops and swings once the player is this close
constexpr qreal kEnemyAttackReach = 140.0;
constexpr qreal kEnemyAttackCooldown = 1.2; // seconds between swings
constexpr int kEnemyAttackDamage = 8;

// How long a defeated enemy's body stays on screen before its item is
// actually removed from the scene - long enough to read as "I killed
// that," short enough that a long combat-heavy session doesn't leave
// corpses piling up forever. Without this, m_enemies (and the
// QGraphicsScene itself, under NoIndex - see the item-index comment in
// the constructor) only ever grows for the lifetime of a chapter: every
// kill is a permanent extra item every future per-tick scene update has
// to linearly scan past, which reads exactly like the "gets choppier
// the longer you play, worse in prop-dense or enemy-heavy areas"
// degradation this was added to fix, not a one-off hitch.
constexpr qreal kCorpseLifetimeSeconds = 6.0;

// 92 used to be noticeably shorter than kTalkRadius (120) - a player could
// walk up to exactly "talk range" of an enemy, the visually obvious "I'm
// standing right next to it" distance, swing, and still whiff because the
// attack itself couldn't reach that far. Matched to the same generous
// reach the enemy/party fixes below use, so "close enough to interact"
// and "close enough to hit" agree.
constexpr qreal kPlayerAttackReach = 140.0;
constexpr int kPlayerAttackDamage = 15;

// --- Party follow/combat AI (2026-09-12) ---
// Every party member except whichever one is currently controlled: fights
// the nearest enemy within range, otherwise follows the controlled
// character. kPartyFollowFallbackSpeed matches the player's own base walk
// speed (see MainWindow::refreshMoveIntent's identical fallback) rather
// than kEnemyChaseSpeed's deliberately-slower pace, so companions keep up
// during ordinary walking; kPartyRunSpeedMultiplier (mirroring
// MainWindow's own kRunSpeedMultiplier - kept in sync by convention, same
// as kSpeedStatToPixelsPerSecond above) is layered on top whenever the
// player is running, so a sprinting player doesn't leave the whole party
// behind.
constexpr qreal kPartyFollowFallbackSpeed = 320.0;
constexpr qreal kPartyRunSpeedMultiplier = 1.6;
constexpr qreal kPartyFollowStopRadius = 110.0; // px - a follower this close to the leader holds still, avoids jitter
constexpr qreal kPartyEngageRadius = 440.0;     // px - same range an enemy notices the player at
// See kEnemyAttackRadius/kEnemyAttackReach's comment above - identical
// radius-bigger-than-reach whiff bug existed here too (100 vs 80).
constexpr qreal kPartyAttackRadius = 110.0;
constexpr qreal kPartyAttackReach = 140.0;
constexpr qreal kPartyAttackCooldown = 1.2;

// --- Magic system: fireballs (2026-09-14) ---
// Intelligence gates whether a character can cast at all, then scales
// everything about the cast - see updateFireballCasting()/castFireball().
// stats.json's roster spans int 2-22 (median 8); 12 keeps the common
// "grunt" hostiles (wolf 6, bear 4, boar 3, goblin 5, every skeleton
// variant 3-4, orc 5, troll 3, zombie_peasant 2, the mech-* line 7-10 -
// checked the whole hostile roster, none crack 11) shut out entirely,
// while still letting the actual mage/spirit/undead-caster archetypes
// (necromancer 21, gnome_wizard 20, the elemental spirits at
// 17-19, cyber_medic 16, etc.) through - the "most
// monsters don't have intelligence enough" split asked for, on the hostile
// side specifically. On the party side this is deliberately low enough
// that lara_cyber's own base 12 already clears it: the player's starting
// character should be able to use the button from the start, even if only
// at the weak end of the scale, rather than the whole system sitting
// invisible until a high-int companion joins many chapters later. Capped
// at kEnemyDetectRadius/kPartyEngageRadius (both 440) rather than given
// its own longer range - a caster firing at a target neither side's own AI
// has "noticed" yet would read as detecting the player from nowhere.
constexpr int kFireballMinIntelligence = 12;
constexpr qreal kFireballCastRadius = 420.0;
constexpr qreal kFireballBaseCooldown = 3.0;    // seconds, at exactly kFireballMinIntelligence
constexpr qreal kFireballCooldownPerInt = 0.2;  // less interval per point of intelligence above that
constexpr qreal kFireballMinCooldown = 1.0;     // floor, however high intelligence climbs
constexpr int kFireballBaseDamage = 12;
constexpr qreal kFireballDamagePerInt = 1.4;    // more powerful per point of intelligence above the threshold
constexpr qreal kFireballSpeed = 900.0;         // px/s the visual bolt travels at

qreal fireballCooldownFor(int intelligence)
{
    const qreal over = std::max(0, intelligence - kFireballMinIntelligence);
    return std::max(kFireballMinCooldown, kFireballBaseCooldown - over * kFireballCooldownPerInt);
}

int fireballDamageFor(int intelligence)
{
    const qreal over = std::max(0, intelligence - kFireballMinIntelligence);
    return kFireballBaseDamage + static_cast<int>(std::lround(over * kFireballDamagePerInt));
}

// A small, fixed-per-character pace variation layered on top of the run/
// walk speed above - seeded from the character's own name (stable across
// the whole game, not re-rolled every tick) so a multi-companion party
// reads as several individuals keeping *roughly* pace with the player
// rather than one uniform block moving in perfect lockstep with them and
// each other.
qreal partySpeedVariationFor(const QString &name)
{
    constexpr qreal kMinVariation = 0.88;
    constexpr qreal kMaxVariation = 1.12;
    const uint h = qHash(name);
    return kMinVariation + (h % 1000) / 999.0 * (kMaxVariation - kMinVariation);
}

// Matching the player's own pace 1:1 only stops a companion from falling
// *further* behind - it can never close a gap it's already fallen into,
// since by definition it's moving no faster than the thing it's chasing.
// A companion that's actually far away instead gets a real speed boost on
// top of everything else, easing back down to normal pace as it closes
// in - standard companion-AI "catch-up"/rubber-banding, and the actual fix
// for "the party can't keep up" rather than just slowing the gap's growth.
constexpr qreal kPartyCatchUpNearDistance = kPartyFollowStopRadius; // px - at/below this, no boost at all
constexpr qreal kPartyCatchUpFarDistance = 900.0;                   // px - at/beyond this, full boost
constexpr qreal kPartyCatchUpMaxMultiplier = 3.0;
qreal partyCatchUpMultiplier(qreal distanceToTarget)
{
    if (distanceToTarget <= kPartyCatchUpNearDistance)
        return 1.0;
    if (distanceToTarget >= kPartyCatchUpFarDistance)
        return kPartyCatchUpMaxMultiplier;
    const qreal t = (distanceToTarget - kPartyCatchUpNearDistance) / (kPartyCatchUpFarDistance - kPartyCatchUpNearDistance);
    return 1.0 + t * (kPartyCatchUpMaxMultiplier - 1.0);
}

// --- Party trail-following and idle crowd ---
// A following (non-fighting) party member walks the controlled character's
// own recorded route instead of pathfinding to it - see followTrail().
// Follower i aims for the spot (i + 1) * kPartyTrailSlotSpacing pixels of
// trail behind the leader, so a moving party reads as a line.
constexpr qreal kPartyTrailSampleSpacing = 40.0;   // px the leader moves between recorded trail points
constexpr qreal kPartyTrailSlotSpacing = 120.0;    // px of trail between consecutive followers
constexpr qreal kPartyTrailTeleportDistance = 400.0; // px - a leader jump this big in one tick starts a new trail
constexpr qreal kPartyTrailSlotTolerance = 30.0;   // px - close enough to its slot to hold still
constexpr qreal kPartyTrailSlotHoldExit = 70.0;    // px - a follower holding at a static slot resumes past this (see followTrail())
constexpr qreal kPartyTrailSlowRadius = 70.0;      // px from its slot inside which a follower eases off its speed
constexpr qreal kPartyTrailMinSpeedFactor = 0.5;   // ...but never below this fraction, so a moving leader never sees it stall
constexpr qreal kPartyTrailLeaderHoldExit = 170.0; // px - a follower waiting for the leader to walk past resumes beyond this
constexpr qreal kPartyTrailPassMargin = 30.0;      // px behind the leader's side line at which it counts as having passed
constexpr int kPartyTrailMaxScanSamples = 12;      // how many older trail points the corner search will try
constexpr qreal kPartyTrailSteerRefreshSeconds = 0.1;
constexpr qreal kPartyTrailTailMax = 720.0;        // px cap on the virtual tail (see m_trailTailDir)
constexpr qreal kPartyTrailRetrySeconds = 0.4;     // A* is used this long after a trail lookup finds nothing reachable
constexpr qreal kPartyTrailSuppressSeconds = 3.0;  // ...or after trail steering stops making progress
constexpr qreal kPartySegmentSampleStep = 24.0;    // px between walkability samples in isSegmentWalkable()

// Once the leader has stood still for kPartyCrowdSettleSeconds (so a brief
// pause between key presses doesn't break the line), followers that can
// see it and are within the crowd area stop lining up and shuffle around it
// instead. Two members conflict only when they're closer than
// kPartyCrowdSpacingX horizontally AND kPartyCrowdSpacingY vertically at
// once - clear on either axis is enough, so the crowd stays loose rather
// than snapping to a grid. Sprites are taller than they are wide, hence
// the smaller vertical figure.
constexpr qreal kPartyCrowdSettleSeconds = 0.35;
constexpr qreal kPartyCrowdRadiusX = 300.0; // px - half-width of the crowd area around the leader
constexpr qreal kPartyCrowdRadiusY = 230.0; // px - half-height
constexpr qreal kPartyCrowdSpacingX = 140.0;
constexpr qreal kPartyCrowdSpacingY = 110.0;
constexpr qreal kPartyCrowdGatherArc = 120.0;   // px of trail behind the leader that late arrivals head for
constexpr qreal kPartyCrowdInnerFraction = 0.6; // outside this fraction of the crowd area, steps must move inward
constexpr qreal kPartyCrowdOuterFraction = 0.9; // steps never land outside this fraction of it
constexpr qreal kPartyShuffleSpeedFactor = 0.45; // of the follower's normal walk speed
constexpr qreal kPartyShuffleMinStep = 40.0;     // px
constexpr qreal kPartyShuffleMaxStep = 170.0;    // px
constexpr qreal kPartyShuffleArriveRadius = 8.0; // px
constexpr qreal kPartyShuffleMaxWalkSeconds = 3.0;
constexpr qreal kPartyShufflePauseMinSeconds = 0.8;
constexpr qreal kPartyShufflePauseMaxSeconds = 2.4;
constexpr qreal kPartyShuffleRetrySeconds = 0.25; // wait after finding no valid step
constexpr int kPartyShuffleCandidateTries = 16;

// A straight-line target reliably got a following/chasing party member
// stuck on the maze walls this game's chapters are now built from (see
// buildBranchingMaze in the chapter scripts) - a corridor almost never
// points directly at the player or an enemy, so "move straight toward it"
// just walks into the nearest wall and sits there. findPath()/
// moveAlongPath() replace that with a real grid path.
constexpr int kPathfindMaxExpansions = 12000; // safety cap, not a real map-size limit - see findPath()
// A companion actively chasing a continuously-moving target (the player
// walking, or an enemy) exceeds kPartyRepathTargetMoveDistance in every
// single interval almost by construction, so this is really "how often do
// we re-run A* while in continuous pursuit," not just "while still en
// route" - a real `perf record` during a multi-companion soak showed
// findPath()'s A* search (plus its QHash-based visited/cost tracking) as a
// measurable, non-trivial slice of total CPU time, driven by call
// frequency more than any single call's own cost. 0.8s instead of 0.5s
// trades a bit of path freshness for meaningfully fewer searches over a
// long session - still frequent enough that a companion notices and
// reroutes around a newly-revealed obstacle quickly, just not 2-3x/sec
// for the entire duration of every chase.
constexpr qreal kPartyRepathInterval = 0.8;
constexpr qreal kPartyRepathTargetMoveDistance = 96.0; // px - a moving target this far from its old path triggers an early repath
constexpr qreal kPartyWaypointArriveRadius = 40.0;  // px - close enough to a waypoint to advance to the next one
// A grid path's own walkability check (tile-center only) can't see every
// continuous-collision snag - real movement can still wedge a character on
// a corner between two nominally-open tiles. If distance to the current
// waypoint hasn't meaningfully shrunk in kPartyStuckSeconds, treat the path
// as bad and force an immediate repath instead of leaving the character
// parked against whatever it hit (see PartyPath::stuckTimer).
constexpr qreal kPartyStuckSeconds = 0.8;
constexpr qreal kPartyStuckProgressThreshold = 8.0; // px - less progress than this per check counts as "not moving"

// How long a stuck-recovery repath's unreachable waypoint cell stays
// blacklisted in m_temporarilyBlockedCells - long enough to force findPath()
// onto a genuinely different route around whatever isn't in the map's own
// static blocking data, short enough that a cell blocked only because a
// prop was standing there a moment ago (since despawned, say) doesn't stay
// falsely off-limits for the rest of the chapter.
constexpr qreal kTemporaryBlockSeconds = 6.0;

// Strength scales attack damage: kBaseAttackDamage + strength, chosen so
// lara_cyber's Strength 10 and a plain skeleton's Strength 8 land close to
// the old flat kPlayerAttackDamage/kEnemyAttackDamage constants above -
// existing combat balance didn't jump the moment stats were introduced,
// it just gained real per-character spread on top. A character with no
// stats.json entry (strength() == 0) falls back to the flat constant
// outright rather than hitting for kBaseAttackDamage alone.
constexpr int kBaseAttackDamage = 5;
int attackDamageFor(int strength, int fallbackDamage)
{
    return strength > 0 ? kBaseAttackDamage + strength : fallbackDamage;
}

// Chance a defeated enemy drops one random item from the non-key-item loot
// pool (see GameScene::dropRandomLoot) - key items (quest relics) are never
// picked at random regardless of this chance, only ever placed deliberately
// by a script.
constexpr qreal kEnemyLootDropChance = 0.5;

// --- Experience/leveling (2026-09-10) ---
// XP needed to advance FROM `level` TO `level+1` - a flat, easy-to-reason-
// about curve (100, 200, 300, ...), not exponential, since this system is
// meant to reward steady play across ~10-20 levels over the whole
// adventure, not a fast climb followed by a wall.
int xpRequiredForLevel(int level)
{
    return level * 100;
}
// A kill's XP scales with the defeated enemy's own max HP (already a
// rough difficulty proxy the roster/stats work established) rather than
// being flat, so a lich_king (hp 55) is worth meaningfully more than a
// slime_water (hp 25) without needing a second, separate "difficulty"
// number per enemy.
int xpForDefeatingEnemy(int enemyMaxHp)
{
    return std::max(10, enemyMaxHp / 2);
}
// Collecting a chapter's key item (its "keyItem": true flag in items.json)
// counts as completing that chapter's main task - a bigger, flat chunk,
// automatic for every chapter with zero script changes needed.
constexpr int kKeyItemTaskExperience = 150;

// Intelligence grows fastest, Strength slower, Speed slowest of all AND
// hard-capped regardless of level - per the explicit request that
// movement needs "a reasonable limit for playability" (an unbounded speed
// bonus would eventually let movement outrun the tile-based collision
// checks it's built on, or just feel uncontrollable long before that).
constexpr int kIntelligenceGrowthPerLevel = 3;
constexpr int kStrengthGrowthPerLevel = 2;
constexpr int kSpeedGrowthPerTwoLevels = 1; // i.e. half the flat-per-level rate above
constexpr int kMaxSpeedBonus = 6;

int intelligenceBonusForLevel(int level)
{
    return (level - 1) * kIntelligenceGrowthPerLevel;
}
int strengthBonusForLevel(int level)
{
    return (level - 1) * kStrengthGrowthPerLevel;
}
int speedBonusForLevel(int level)
{
    return std::min(kMaxSpeedBonus, ((level - 1) / 2) * kSpeedGrowthPerTwoLevels);
}

constexpr qreal kTalkRadius = 120.0; // px - how close the player must be to interact with an NPC
constexpr qreal kItemPickupRadius = 100.0; // px - how close to auto-collect a world item

// Far above the highest Z any prop/character can reach (they're Z-sorted by
// their own world Y position - see Character::updatePixmap()/placeProp() -
// so this only ever needs to clear "the map's pixel height", not literally
// any value), guaranteeing the lighting overlay (see the "lighting" map
// field below) paints dead last, over every tile/prop/character alike.
constexpr qreal kLightingOverlayZValue = 1'000'000.0;
// Anything else in a map's "lighting" field is treated as "no lighting" -
// see LightingOverlayItem::paint() for what each one actually looks like.
const QSet<QString> kRecognizedLightingModes = { QStringLiteral("sunrise"), QStringLiteral("sunset"),
                                                  QStringLiteral("torch"), QStringLiteral("cavern"),
                                                  QStringLiteral("mystical") };

// How every Character/Prop's ground shadow (see their own paint()
// overrides) leans, in item-local pixels from the ground-contact point.
// sunrise/sunset are the only modes with an actual light *direction* (see
// LightingOverlayItem::paint() - the glow is anchored at a top corner), so
// only those two tilt the shadow away from that corner; every other mode
// (torch/cavern/mystical, or no lighting at all) gets a small neutral
// straight-down shadow instead of pretending to know a direction it
// doesn't have.
QPointF shadowOffsetForLighting(const QString &mode)
{
    // Doubled along with the 2x asset scale (see tools/upscale_2x.py) - an
    // un-doubled offset would read as half as pronounced against the now-
    // bigger sprites.
    if (mode == QLatin1String("sunrise")) // glow from top-right -> shadow leans down-left
        return QPointF(-14, 22);
    if (mode == QLatin1String("sunset")) // glow from top-left -> shadow leans down-right
        return QPointF(14, 22);
    return QPointF(0, 18);
}

// Picked from arbitrarily (not cycled in a fixed sequence) each time a
// level loads. Grown from just "theme" (2026-09-09) in three rounds: first
// music01-03.ogg (from FLAC), then 9 more (from mp3), then 26 more (from
// FLAC again) - all non-"theme" tracks follow the same musicNN naming,
// regardless of whether the source had a real title. music04, music07,
// music09, music10, music11, and music12 were removed from the pool
// entirely by explicit request (2026-09-10) - their .ogg files are
// deleted, not just unlisted here, and their numbers are retired rather
// than the remaining/later tracks being renumbered down to close the gap
// (hence music13 picking up right after the highest surviving number at
// the time, 12, rather than backfilling 04/07/09/10/11/12).
const QStringList kLevelMusicTracks = {
    QStringLiteral("theme"),   QStringLiteral("music01"), QStringLiteral("music02"), QStringLiteral("music03"),
    QStringLiteral("music05"), QStringLiteral("music06"), QStringLiteral("music08"), QStringLiteral("music13"),
    QStringLiteral("music14"), QStringLiteral("music15"), QStringLiteral("music16"), QStringLiteral("music17"),
    QStringLiteral("music18"), QStringLiteral("music19"), QStringLiteral("music20"), QStringLiteral("music21"),
    QStringLiteral("music22"), QStringLiteral("music23"), QStringLiteral("music24"), QStringLiteral("music25"),
    QStringLiteral("music26"), QStringLiteral("music27"), QStringLiteral("music28"), QStringLiteral("music29"),
    QStringLiteral("music30"), QStringLiteral("music31"), QStringLiteral("music32"), QStringLiteral("music33"),
    QStringLiteral("music34"), QStringLiteral("music35"), QStringLiteral("music36"), QStringLiteral("music37"),
    QStringLiteral("music38")
};
}

GameScene::GameScene(GameState *state, const QString &mapPath, QObject *parent)
    : QGraphicsScene(parent)
    , m_state(state)
    , m_mapPath(mapPath)
{
    // MainWindow only ever talks to GameScene - proxy the script engine's
    // dialogue signals through our own of the same name rather than
    // exposing m_scriptEngine itself.
    connect(&m_scriptEngine, &ScriptEngine::dialogueRequested, this, &GameScene::dialogueRequested);
    connect(&m_scriptEngine, &ScriptEngine::dialogueEnded, this, &GameScene::dialogueEnded);

    // Every level's entrance now opens on the same non-looping ambient
    // intro rather than jumping straight into the level's own (randomized)
    // music - see playRandomLevelTrack() for what plays once this actually
    // finishes. ambient.ogg itself runs 5 minutes, far longer than an
    // entrance intro should hold the level's own music off, so it's cut
    // short with a 2-second fade-out at the 2:00 mark rather than left to
    // play in full - see AudioManager::fadeOutMusic(). The plain
    // musicFinished() connection stays too, as a fallback: if ambient.ogg
    // is ever swapped for something under 2 minutes, it reaches its own
    // natural end first and this fires normally instead. Both paths lead
    // to the same playRandomLevelTrack() (each only reachable once - the
    // fade path via QMediaPlayer::stop() rather than natural EndOfMedia,
    // and the timer is one-shot itself, so there is no double-fire to
    // guard against here).
    m_audio.playMusic(QStringLiteral("ambient"), false);
    connect(&m_audio, &AudioManager::musicFinished, this, &GameScene::playRandomLevelTrack,
            Qt::SingleShotConnection);
    QTimer::singleShot(120000, this, [this] { m_audio.fadeOutMusic(2000); });

    // Back to NoIndex - re-checked directly, twice now, not assumed either
    // time. Originally kept over BspTreeIndex because BspTreeIndex once
    // caused a "ghost render" bug (stale entries when an item's position
    // changes more than once between two actual paints) and an early A/B
    // showed no benefit worth that risk. Later, once TileMapItem's and
    // LightingOverlayItem's own animation timers turned out to be forcing
    // their whole (map-sized) boundingRect dirty via a bare update() every
    // tick, a longer soak showed NoIndex degrading over a multi-minute
    // session where BspTreeIndex didn't, and BspTreeIndex was re-verified
    // safe against the ghost-render trigger - so it became the default.
    // That fix (see VisibleSceneRect.h - both timers now invalidate only
    // the visible viewport, not the whole map) is still in place and still
    // correct. But it turned out not to be the whole story: with several
    // Character items in the scene (the new party-AI companions), BOTH
    // NoIndex and BspTreeIndex show the same kind of periodic, bursty
    // frame-cost degradation over a multi-minute soak - switching index
    // method didn't fix or explain it, so it isn't what NoIndex-vs-
    // BspTreeIndex was ever actually deciding between. Given that, NoIndex
    // wins by default again: same measured degradation either way, but
    // without BspTreeIndex's documented ghost-render risk (re-verified
    // safe only for a single controlled character, not yet against
    // several independently-moving party members).
    setItemIndexMethod(QGraphicsScene::NoIndex);

    QString mapError;
    if (!m_map.load(m_mapPath, &mapError))
        qWarning() << "Failed to load map:" << mapError;

    setSceneRect(0, 0, m_map.pixelWidth(), m_map.pixelHeight());

    auto *mapItem = new TileMapItem(m_map);
    mapItem->setZValue(-10);
    addItem(mapItem);
    m_tileMapItem = mapItem;

    // Read the map JSON once, up front, for the GameScene-level fields
    // TileMap itself doesn't care about: "sandbox" (below), "lighting"
    // (below), and "script" (used at the end of the constructor).
    QJsonObject mapRoot;
    {
        QFile mapJsonFile(m_mapPath);
        if (mapJsonFile.open(QIODevice::ReadOnly))
            mapRoot = QJsonDocument::fromJson(mapJsonFile.readAll()).object();
    }

    // Optional ambient tint - see docs/SCRIPTING.md's "Lighting" section and
    // LightingOverlayItem::paint() for what each mode looks like. Absent or
    // unrecognized means no overlay at all: nothing is constructed, so a
    // map that doesn't ask for this pays nothing for it.
    const QString lightingMode = mapRoot.value("lighting").toString();
    if (kRecognizedLightingModes.contains(lightingMode)) {
        auto *lightingItem = new LightingOverlayItem(lightingMode, m_map.pixelWidth(), m_map.pixelHeight());
        lightingItem->setZValue(kLightingOverlayZValue);
        addItem(lightingItem);
        m_lightingOverlayItem = lightingItem;
    }
    // Computed from the mode string directly (not gated behind
    // kRecognizedLightingModes) - an unrecognized/absent mode still gets
    // the sensible neutral straight-down shadow from the fallback branch.
    m_shadowOffset = shadowOffsetForLighting(lightingMode);
    const bool sandboxMode = mapRoot.value("sandbox").toBool(false);

    // Everything in this `if` is proof-of-concept-only content (the full
    // character roster shown off as a grid, every prop shown off in a
    // grid, the hand-authored sandbox village/nature areas, 4 fixed
    // enemies) - see assets/maps/sandbox.json, which is the only map that
    // still opts into it via `"sandbox": true`. A real chapter map spawns
    // only what its own script asks for.
    if (sandboxMode) {
        // The full character roster, so Tab (in MainWindow) can cycle
        // through every generated character as a proof of concept - not
        // just a curated few. Discovered dynamically from
        // assets/characters/ (one subfolder per character, each holding
        // <name>/<name>.json) rather than hardcoded, since the roster is
        // large and keeps growing as new art lands. Laid out in a simple
        // grid across the map so they're all visible standing around; only
        // whichever one is currently controlled actually moves.
        const QDir charactersDir(QStringLiteral(ASSET_DIR "/characters"));
        const QStringList characterNames = charactersDir.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);

        constexpr int columnsPerRow = 10;
        constexpr int startTileCol = 1;
        constexpr int startTileRow = 1;

        int gridIndex = 0;
        for (const QString &name : characterNames) {
            const int tileCol = startTileCol + (gridIndex % columnsPerRow);
            const int tileRow = startTileRow + (gridIndex / columnsPerRow);
            Character *character = createCharacterAt(name, tileCol, tileRow, 100);
            if (!character)
                continue;

            m_party.append(character);
            m_charactersByName.insert(name, character);
            if (name == QStringLiteral("lara_cyber"))
                m_controlledIndex = m_party.size() - 1;
            ++gridIndex;
        }

        spawnEnemies();
    }

    // The props catalog itself is always loaded (api.spawnProp() needs it
    // in every chapter, not just the sandbox) - only the showcase grid and
    // the sandbox's hand-authored layouts below are proof-of-concept-only.
    QFile propsCatalogFile(QStringLiteral(ASSET_DIR "/props/props.json"));
    if (propsCatalogFile.open(QIODevice::ReadOnly)) {
        const QJsonObject propsCatalog = QJsonDocument::fromJson(propsCatalogFile.readAll()).object();
        m_propsCatalog = propsCatalog.value("props").toObject(); // kept around for spawnPropAt()

        if (sandboxMode) {
            // Every standalone environment prop, laid out as its own
            // showcase grid to the right of the character roster - same
            // "dynamically discover everything, no hardcoded list" spirit
            // as the character roster above.
            constexpr int propsColumnsPerRow = 9;
            constexpr qreal propColumnPitchPx = 320.0;
            constexpr qreal propRowPitchPx = 380.0;
            constexpr qreal propsStartX = 12 * 128.0; // just past the character grid
            constexpr qreal propsStartY = 128.0;

            int propIndex = 0;
            for (auto it = m_propsCatalog.constBegin(); it != m_propsCatalog.constEnd(); ++it) {
                const QString name = it.key();
                const QJsonObject entry = it.value().toObject();
                const qreal targetWidth = entry.value("width").toDouble();
                const bool blocksMovement = entry.value("blocksMovement").toBool(true);
                const QString imagePath = QStringLiteral(ASSET_DIR "/props/%1.png").arg(name);
                if (!QFileInfo::exists(imagePath)) {
                    qWarning() << "Prop image missing for" << name << "at" << imagePath;
                    continue;
                }

                auto *prop = new Prop(imagePath, targetWidth);
                prop->setShadowOffset(m_shadowOffset);
                const qreal worldX = propsStartX + (propIndex % propsColumnsPerRow) * propColumnPitchPx;
                const qreal worldY = propsStartY + (propIndex / propsColumnsPerRow) * propRowPitchPx;
                placeProp(prop, worldX, worldY, blocksMovement);
                ++propIndex;
            }

            // The old placeholder map marked a few obj-layer cells as
            // generic "tree"/"rock" blockers using flat placeholder tiles -
            // now that real tree/rock props exist, those spots get the
            // real thing instead. Alternates between two variants per kind
            // purely for visual variety, not for any semantic difference.
            QFile markersFile(QStringLiteral(ASSET_DIR "/maps/sandbox_prop_markers.json"));
            if (markersFile.open(QIODevice::ReadOnly)) {
                const QJsonArray markers = QJsonDocument::fromJson(markersFile.readAll()).object().value("markers").toArray();
                static const QStringList treeVariants = { QStringLiteral("pine_tree"), QStringLiteral("oak_tree") };
                static const QStringList rockVariants = { QStringLiteral("rocks_small"), QStringLiteral("boulder_large") };
                int treeCount = 0;
                int rockCount = 0;

                for (const QJsonValue &v : markers) {
                    const QJsonObject marker = v.toObject();
                    const QString kind = marker.value("kind").toString();
                    const bool isTree = (kind == QStringLiteral("tree"));
                    const QString &name = isTree ? treeVariants.at(treeCount++ % treeVariants.size())
                                                  : rockVariants.at(rockCount++ % rockVariants.size());
                    spawnPropAt(name, marker.value("col").toInt(), marker.value("row").toInt());
                }
            }

            // The hand-authored village (west) and nature (east) areas
            // south of the showcase grid/pond/enemy arena - every one of
            // the 40 catalog props placed deliberately once, instead of
            // the auto-grid above.
            QFile villageLayoutFile(QStringLiteral(ASSET_DIR "/maps/sandbox_village_layout.json"));
            if (villageLayoutFile.open(QIODevice::ReadOnly)) {
                const QJsonArray layout = QJsonDocument::fromJson(villageLayoutFile.readAll()).object().value("props").toArray();
                for (const QJsonValue &v : layout) {
                    const QJsonObject entry = v.toObject();
                    spawnPropAt(entry.value("name").toString(), entry.value("col").toInt(), entry.value("row").toInt());
                }
            }

            // Three more vignettes (haunted/decimated village, periferia)
            // south of the above - see sandbox_ruins_layout.json's comment
            // for why they live here rather than in any chapter script.
            QFile ruinsLayoutFile(QStringLiteral(ASSET_DIR "/maps/sandbox_ruins_layout.json"));
            if (ruinsLayoutFile.open(QIODevice::ReadOnly)) {
                const QJsonArray layout = QJsonDocument::fromJson(ruinsLayoutFile.readAll()).object().value("props").toArray();
                for (const QJsonValue &v : layout) {
                    const QJsonObject entry = v.toObject();
                    spawnPropAt(entry.value("name").toString(), entry.value("col").toInt(), entry.value("row").toInt());
                }
            }
        }
    } else {
        qWarning() << "Failed to open props catalog" << propsCatalogFile.fileName();
    }

    // Gives every real chapter map a horizon (exterior) or enclosing walls
    // (interior) at its edges - sandbox.json hand-builds its own border
    // (the water moat), so it's excluded here.
    if (!sandboxMode)
        decorateMapEdges(mapRoot);

    // Also always loaded, same reasoning as the props catalog - a chapter's
    // script needs it for scriptSpawnItem() regardless of sandbox mode.
    QFile itemsCatalogFile(QStringLiteral(ASSET_DIR "/items/items.json"));
    if (itemsCatalogFile.open(QIODevice::ReadOnly)) {
        const QJsonObject itemsCatalog = QJsonDocument::fromJson(itemsCatalogFile.readAll()).object();
        m_itemsCatalog = itemsCatalog.value("items").toObject();

        // The random enemy-loot pool - every item NOT marked "keyItem" (see
        // items.json's own comment). Built once here rather than filtered
        // per-drop, since the catalog doesn't change during a scene's life.
        for (auto it = m_itemsCatalog.constBegin(); it != m_itemsCatalog.constEnd(); ++it) {
            if (!it.value().toObject().value("keyItem").toBool(false))
                m_lootPool.append(it.key());
        }
    } else {
        qWarning() << "Failed to open items catalog" << itemsCatalogFile.fileName();
    }

    // Optional, deliberately sparse - most of the roster has no entry at
    // all, which is exactly the "silent whistle / fall back to attack.wav"
    // default described where it's used (playCreatureSound()). No warning
    // if this file is ever missing entirely - a totally silent/default
    // roster is a valid state, not an error.
    QFile creatureSoundsFile(QStringLiteral(ASSET_DIR "/characters/sounds.json"));
    if (creatureSoundsFile.open(QIODevice::ReadOnly))
        m_creatureSoundsCatalog = QJsonDocument::fromJson(creatureSoundsFile.readAll()).object().value("sounds").toObject();

    // Unlike sounds.json, every roster character has an entry here - see
    // createCharacterAt(), which looks each one up by name right after
    // spawning. Still tolerant of a missing file/entry (0/0/0, meaning "use
    // the old flat fallback constant" at every consumer) rather than
    // warning, so a character added without updating this file doesn't
    // break the game, just plays with the pre-stats numbers.
    QFile statsFile(QStringLiteral(ASSET_DIR "/characters/stats.json"));
    if (statsFile.open(QIODevice::ReadOnly))
        m_statsCatalog = QJsonDocument::fromJson(statsFile.readAll()).object().value("stats").toObject();

    applyHealthBarDisplay();

    // Opt-in per map: only load/run a script if the map JSON names one.
    // Resolved relative to the map file itself, same convention TileMap
    // already uses for "tileset".
    const QString scriptRelPath = mapRoot.value("script").toString();
    if (!scriptRelPath.isEmpty()) {
        const QString scriptPath = QFileInfo(m_mapPath).dir().filePath(scriptRelPath);
        QString scriptError;
        if (!m_scriptEngine.loadFile(scriptPath, &scriptError)) {
            qWarning() << "Failed to load level script:" << scriptError;
        } else {
            // Deferred to the next event-loop turn rather than called
            // right here: onLevelStart can emit dialogueRequested
            // (immediately, via a `say` as its very first yield), and
            // this constructor is still running - whoever is
            // constructing us (MainWindow) hasn't connected to our
            // signals yet, so an immediate call's emission would fire
            // into a signal with no listeners and be silently lost.
            QTimer::singleShot(0, this, [this] { m_scriptEngine.callEntryPoint(QStringLiteral("onLevelStart")); });
        }
    }

    connect(&m_tickTimer, &QTimer::timeout, this, &GameScene::onTick);
    m_clock.start();
    m_tickTimer.start(kTickIntervalMs);
}

void GameScene::playRandomLevelTrack()
{
    // Never the same track that was just playing - "alternate" reads as
    // "keep it varied," not "let it sometimes repeat by chance," so the
    // previous track is excluded from the pool rather than trusting
    // randomness alone to avoid a repeat.
    QStringList musicChoices = kLevelMusicTracks;
    musicChoices.removeAll(m_state->lastMusicTrack);
    if (musicChoices.isEmpty())
        musicChoices = kLevelMusicTracks;
    const QString chosenTrack = musicChoices.at(QRandomGenerator::global()->bounded(musicChoices.size()));
    m_state->lastMusicTrack = chosenTrack;
    m_audio.playMusic(chosenTrack);
}

Character *GameScene::createCharacterAt(const QString &name, int tileCol, int tileRow, int hp)
{
    const qreal worldX = (tileCol + 0.5) * m_map.tileWidth();
    const qreal worldY = (tileRow + 0.5) * m_map.tileHeight();
    return createCharacterAtWorldFeet(name, QPointF(worldX, worldY), hp, /*resolveCollision=*/true);
}

Character *GameScene::createCharacterAtWorldFeet(const QString &name, QPointF worldFeetPos, int hp, bool resolveCollision)
{
    const QDir charactersDir(QStringLiteral(ASSET_DIR "/characters"));
    const QString jsonPath = charactersDir.filePath(name + QStringLiteral("/") + name + QStringLiteral(".json"));
    if (!QFileInfo::exists(jsonPath)) {
        qWarning() << "Character sprite sheet missing for" << name << "at" << jsonPath;
        return nullptr;
    }

    auto &cache = spriteSheetCache();
    auto cacheIt = cache.find(name);
    if (cacheIt == cache.end()) {
        SpriteSheet sheet;
        QString spriteError;
        if (!sheet.load(jsonPath, &spriteError)) {
            qWarning() << "Failed to load sprite sheet for" << name << ":" << spriteError;
            return nullptr;
        }
        cacheIt = cache.insert(name, sheet);
    }

    auto *character = new Character(cacheIt.value());
    character->setName(name); // for creature-sound lookups (whistle/roar) - see playCreatureSound()
    const QJsonObject statsEntry = m_statsCatalog.value(name).toObject();
    character->setStats(statsEntry.value("str").toInt(), statsEntry.value("int").toInt(), statsEntry.value("spd").toInt());
    character->setTileMap(&m_map);
    character->setBlockingAreas(&m_blockingAreas);
    character->setShadowOffset(m_shadowOffset);
    if (hp > 0)
        character->setMaxHp(hp); // hp <= 0 means "no combat stats" - an NPC never gets a health bar this way

    // Placing by feetPos() (still (0,0) + feetOffset() at this point - the
    // constructor never calls setPos()) rather than a hand-picked fraction
    // of boundingRect() keeps this in sync with SpriteSheet::feetFraction()
    // automatically, whatever it's currently set to - a hardcoded fraction
    // here silently drifted out of sync with feetFraction() more than once
    // as that constant got re-measured (see its own comment), each time
    // quietly spawning every character with their feet off the intended
    // tile center by the difference.
    const QPointF feetOffset = character->feetPos();

    // See resolveSpawnCollision()'s own comment - two characters spawned at
    // the exact same feet position (whatever the cause) would otherwise
    // stand perfectly on top of each other forever, reading as one entity.
    // Skipped when restoring a save's exact recorded position (see
    // restoreSnapshot()) - that position is already known-good (nothing
    // else occupies it, since it's exactly where this same character
    // legitimately stood when the game was saved), and re-resolving
    // collision against a freshly-empty m_occupiedCharacterCells could
    // only ever nudge it somewhere *other* than the saved spot.
    const QPointF resolvedFeet = resolveCollision
            ? resolveSpawnCollision(worldFeetPos, m_occupiedCharacterCells)
            : worldFeetPos;

    character->setPos(resolvedFeet.x() - feetOffset.x(), resolvedFeet.y() - feetOffset.y());
    addItem(character);
    return character;
}

void GameScene::placeProp(Prop *prop, qreal worldGroundX, qreal worldGroundY, bool blocksMovement)
{
    // See resolveSpawnCollision()'s own comment - two props (a world item
    // counts as one too, see spawnItemInWorld()) placed at the exact same
    // ground anchor would otherwise sit perfectly on top of each other
    // forever, reading as one object. The cell size is tight enough that
    // deliberately close placements (a scatterOrganic() clump, item-atop-
    // scenery) are never affected - only a genuine same-point coincidence.
    const QPointF resolvedGround = resolveSpawnCollision(QPointF(worldGroundX, worldGroundY), m_occupiedPropCells);
    worldGroundX = resolvedGround.x();
    worldGroundY = resolvedGround.y();

    const QPointF anchor = prop->groundAnchorOffset();
    prop->setPos(worldGroundX - anchor.x(), worldGroundY - anchor.y());
    // Depth-sort by ground-contact Y rather than a fixed stacking order, so
    // a character standing "above" (smaller world Y than) a prop's base is
    // drawn behind it, and one standing "below" is drawn in front - the
    // same trick Character::tick() uses for itself every frame.
    prop->setZValue(worldGroundY);
    addItem(prop);
    if (blocksMovement)
        m_blockingAreas.insert(prop->mapToScene(prop->footprintRect()).boundingRect());
}

Prop *GameScene::spawnPropAt(const QString &name, int tileCol, int tileRow)
{
    const QJsonObject entry = m_propsCatalog.value(name).toObject();
    const qreal targetWidth = entry.value("width").toDouble();
    const bool blocksMovement = entry.value("blocksMovement").toBool(true);
    const QString imagePath = QStringLiteral(ASSET_DIR "/props/%1.png").arg(name);
    if (!QFileInfo::exists(imagePath)) {
        qWarning() << "Prop image missing for" << name << "at" << imagePath;
        return nullptr;
    }

    auto *prop = new Prop(imagePath, targetWidth);
    prop->setName(name);
    prop->setShadowOffset(m_shadowOffset);
    m_props.append(prop);
    const qreal worldX = (tileCol + 0.5) * m_map.tileWidth();
    const qreal worldY = (tileRow + 0.5) * m_map.tileHeight();
    placeProp(prop, worldX, worldY, blocksMovement);
    return prop;
}

void GameScene::decorateMapEdges(const QJsonObject &mapRoot)
{
    const bool interior = mapRoot.value("interior").toBool(false);
    const QString catalogPath = interior ? QStringLiteral(ASSET_DIR "/props/walls.json")
                                          : QStringLiteral(ASSET_DIR "/props/borders.json");
    // Interior maps opt into a wall look by name (independent of tileset);
    // exterior maps get one automatically from whichever tileset they use.
    const QString lookupKey = interior ? mapRoot.value("wallTheme").toString()
                                        : QFileInfo(mapRoot.value("tileset").toString()).baseName();
    if (lookupKey.isEmpty())
        return;

    QFile catalogFile(catalogPath);
    if (!catalogFile.open(QIODevice::ReadOnly))
        return;
    const QJsonObject root = QJsonDocument::fromJson(catalogFile.readAll()).object();
    const QJsonArray list = root.value(interior ? QStringLiteral("walls") : QStringLiteral("borders"))
                                     .toObject()
                                     .value(lookupKey)
                                     .toArray();
    if (list.isEmpty()) {
        qDebug() << (interior ? "No wall set mapped for wallTheme" : "No border set mapped for tileset") << lookupKey;
        return;
    }

    QStringList names;
    for (const QJsonValue &v : list)
        names.append(v.toString());

    const int width = m_map.widthInTiles();
    const int height = m_map.heightInTiles();
    const int tileW = m_map.tileWidth();
    const int tileH = m_map.tileHeight();
    // Horizon art (border only, never the interior wall set) is a wide 3:1
    // landscape strip - fine as placed on the top/bottom edges, but a
    // landscape backdrop simply repeated down a side edge reads as a stack
    // of small windows, not a horizon, so it's rotated a quarter turn there
    // instead. The source art is mostly transparent sky padding with only a
    // thin silhouette band near the bottom (see groundAnchorOffset - it
    // anchors near the *bottom* of the image); nudging the top/bottom strips
    // outward moved that already-small visible band even further outside
    // the camera's reachable range, so kHorizonEdgeOffsetPx now nudges them
    // *inward* (toward the play field) instead, bringing the visible
    // silhouette back into view.
    enum class Edge { Top, Right, Bottom, Left };
    constexpr qreal kHorizonEdgeOffsetPx = 100.0;
    // A horizon strip is wide (9 tiles along its edge at the current asset
    // scale) - spawning one per tile stacks ~9 fully-overlapping copies at
    // any given point along the edge, on ALL four edges: the top and bottom
    // rows placed one per column, and the side ones one per row. That was
    // already wasteful, and it is a real cost: each copy is a big alpha-
    // blended pixmap (and its shadow), and a border row on screen put
    // ~190 props in view at once - frame time scales with props in view,
    // so running along an edge dropped frames on a large window. On the
    // side edges each copy is also rotated, which can't take Qt's cheap
    // axis-aligned blit path (the same "no fast path for a non-identity
    // transform" rasterizer Qt uses for scaling - see MainWindow's zoom
    // comments - applies to rotation too). Spawning one every
    // kEdgePropStride tiles instead - well under the 9-tile span, so
    // coverage stays seamless (3 overlapping copies at every point) -
    // keeps the same visual result with a third as many props to draw.
    // Blocking coverage is untouched: every tile is still registered solid
    // below, independent of whether that tile got a visual prop.
    constexpr int kEdgePropStride = 3;
    int i = 0;
    auto place = [this, &names, &i, tileW, tileH, height, interior](int col, int row, Edge edge, bool spawnVisual) {
        // Prop::footprintRect() sizes each prop's own collision box relative
        // to *its own* rendered height (deliberately small, so a character
        // can walk near/behind a tall canopy) - fine for a single decoration,
        // but cycling differently-proportioned props along a ring means a
        // short prop's footprint often doesn't reach far enough to connect
        // with its neighbor's, leaving a real walkable gap even though the
        // art visually overlaps. A continuous border/wall needs a guarantee
        // that doesn't depend on which specific art landed on which tile (or
        // on whether this tile got a visual prop at all - see
        // kEdgePropStride above), so register the whole tile as blocked
        // here directly, on top of whatever footprint the prop itself
        // contributes.
        m_blockingAreas.insert(QRectF(col * tileW, row * tileH, tileW, tileH));
        if (!spawnVisual)
            return;

        Prop *prop = spawnPropAt(names.at(i % names.size()), col, row);
        ++i;
        if (interior || !prop)
            return;
        if (edge == Edge::Left || edge == Edge::Right) {
            prop->setTransformOriginPoint(prop->boundingRect().center());
            prop->setRotation(-90.0);
            if (edge == Edge::Left)
                prop->moveBy(-kHorizonEdgeOffsetPx, 0.0);
        } else if (edge == Edge::Bottom) {
            // The eyeballed kHorizonEdgeOffsetPx nudge (still used below for
            // Top) was tuned only to reveal the art's visible silhouette
            // band, not to land it on the map edge, and for the bottom row
            // it happened to overshoot past the border line. spawnPropAt
            // anchors this prop at the *tile center* of the last row, so
            // reposition it directly here instead: pin the pixmap's actual
            // rendered bottom edge to exactly the map's bottom border line
            // (height * tileH), whatever the art's own height/aspect ratio
            // is - no more guessing at a flat pixel offset.
            prop->setY(height * tileH - prop->boundingRect().height());
        } else {
            // Both edges nudge down - the visible silhouette sits near the
            // *bottom* of the source art regardless of which edge it's
            // used on, so "down" is what reveals more of it either way,
            // not "toward the field" (that reasoning held for the top edge
            // but turned out wrong for the bottom one).
            prop->moveBy(0.0, kHorizonEdgeOffsetPx);
        }
    };
    // The stride reduction above only applies to the exterior horizon art -
    // an interior wall is a run of separate, non-overlapping wall segments
    // (one per tile, see the `interior` early-return above), so skipping
    // tiles there would just leave visible gaps in the wall.
    const bool thinEdges = !interior;
    // Walk the outer ring clockwise, each corner visited exactly once.
    for (int col = 0; col < width; ++col)
        place(col, 0, Edge::Top, !thinEdges || col % kEdgePropStride == 0);
    for (int row = 1; row < height; ++row)
        place(width - 1, row, Edge::Right, !thinEdges || (row - 1) % kEdgePropStride == 0);
    for (int col = width - 2; col >= 0; --col)
        place(col, height - 1, Edge::Bottom, !thinEdges || col % kEdgePropStride == 0);
    for (int row = height - 2; row >= 1; --row)
        place(0, row, Edge::Left, !thinEdges || (row - 1) % kEdgePropStride == 0);
}

Character *GameScene::controlledCharacter() const
{
    if (m_party.isEmpty())
        return nullptr;
    return m_party.at(m_controlledIndex);
}

bool GameScene::findKeyItemWorldPos(QPointF *outPos) const
{
    for (const WorldItem &item : m_worldItems) {
        if (m_itemsCatalog.value(item.itemId).toObject().value(QStringLiteral("keyItem")).toBool(false)) {
            *outPos = QPointF(item.worldX, item.worldY);
            return true;
        }
    }
    return false;
}

void GameScene::switchToNextCharacter()
{
    if (m_party.size() < 2)
        return;

    // A former controlled target can die from an in-flight hit while the
    // party keeps playing. Never transfer input back to that corpse.
    for (int offset = 1; offset < m_party.size(); ++offset) {
        const int nextIndex = (m_controlledIndex + offset) % m_party.size();
        if (m_party.at(nextIndex)->isDead())
            continue;
        m_party.at(m_controlledIndex)->setVelocity(QPointF(0, 0));
        m_party.at(m_controlledIndex)->setRunning(false); // only the controlled character's run flag is ever refreshed - see MainWindow::refreshMoveIntent()
        m_controlledIndex = nextIndex;
        applyHealthBarDisplay();
        return;
    }
}

void GameScene::commandSelectedCharacter()
{
    if (m_selectedIndex < 0 || m_selectedIndex >= m_party.size() || m_selectedIndex == m_controlledIndex)
        return;
    if (m_party.at(m_selectedIndex)->isDead())
        return;

    m_party.at(m_controlledIndex)->setVelocity(QPointF(0, 0));
    m_party.at(m_controlledIndex)->setRunning(false); // only the controlled character's run flag is ever refreshed - see MainWindow::refreshMoveIntent()
    m_controlledIndex = m_selectedIndex;
    applyHealthBarDisplay();
}

void GameScene::spawnEnemies()
{
    // A handful of the roster's monster-type characters, planted as hostile
    // mobs in the open grass field to the right of the character/prop
    // showcase grids (columns ~22-35 of the demo map are empty of both).
    // Fixed positions/roster for now - this is the first combat pass, not a
    // spawner system. A script can add more via api.spawnEnemy().
    struct Spawn
    {
        QString name;
        int tileCol;
        int tileRow;
    };
    static const QVector<Spawn> spawns = {
        { QStringLiteral("skeleton_swordsman"), 25, 4 },
        { QStringLiteral("zombie_peasant"), 29, 7 },
        { QStringLiteral("orc"), 24, 10 },
        { QStringLiteral("wraith"), 32, 5 },
    };

    for (const Spawn &spawn : spawns) {
        Character *character = createCharacterAt(spawn.name, spawn.tileCol, spawn.tileRow, kEnemyHp);
        if (character)
            m_enemies.append(Enemy{ character, spawn.name, 0.0, false });
    }
}

void GameScene::triggerPlayerAttack()
{
    Character *player = controlledCharacter();
    if (!player || player->isDead() || player->isActing())
        return;

    player->triggerAttack();
    playCreatureSound(player->name(), QStringLiteral("roar"));

    for (Enemy &enemy : m_enemies) {
        if (enemy.character->isDead())
            continue;
        // feetPos(), not sceneBoundingRect() - the latter is the sprite's
        // full (now heavily padded, see tools/refit_sprites.py) frame, so
        // a hit test against it would count a hit from a swing that's
        // nowhere near the character's actual visible body, just its empty
        // margin.
        if (player->isWithinMeleeReach(enemy.character->feetPos(), kPlayerAttackReach)) {
            enemy.character->applyDamage(attackDamageFor(player->strength(), kPlayerAttackDamage));
            m_audio.playSound(enemy.character->isDead() ? QStringLiteral("death") : QStringLiteral("hit"));
            if (enemy.character->isDead())
                awardEnemyDefeatRewards(enemy);
        }
    }
}

void GameScene::killControlledCharacter()
{
    Character *player = controlledCharacter();
    if (!player || player->isDead())
        return;
    if (player->maxHp() <= 0)
        player->setMaxHp(1); // see the header comment - never a silent no-op
    player->applyDamage(player->maxHp());
    m_audio.playSound(QStringLiteral("death"));
    if (player->isDead())
        notifyPlayerDeathIfNeeded();
}

void GameScene::notifyPlayerDeathIfNeeded()
{
    // Control can change while a projectile is in flight. Game over is
    // defined by who is controlled now, not who was targeted at launch.
    Character *controlled = controlledCharacter();
    if (m_playerDeathNotified || !controlled || !controlled->isDead())
        return;
    m_playerDeathNotified = true;
    m_scriptEngine.callEntryPoint(QStringLiteral("onPlayerDied"));
    // Rings at ~2x the normal loudness (see AudioManager::playSound's
    // volume>1.0 behavior) - this is meant to be an unmistakable "you
    // died" beat, not just another sfx among many.
    m_audio.playSound(QStringLiteral("funeral_bell_4s"), 2.0);
    emit playerDied();
}

void GameScene::awardEnemyDefeatRewards(Enemy &enemy)
{
    if (enemy.scriptNotified)
        return;
    enemy.scriptNotified = true;
    enemy.corpseTimeRemaining = kCorpseLifetimeSeconds;
    awardExperience(xpForDefeatingEnemy(enemy.character->maxHp()));
    dropRandomLoot(enemy.character->feetPos().x(), enemy.character->feetPos().y());
    m_scriptEngine.callEntryPoint(QStringLiteral("onEnemyDefeated"), { QJSValue(enemy.name) });
}

void GameScene::updateCorpseCleanup(qreal dtSeconds)
{
    // Iterate backward so erasing an expired corpse doesn't shift the index
    // of anything this loop still needs to visit.
    for (int i = m_enemies.size() - 1; i >= 0; --i) {
        Enemy &enemy = m_enemies[i];
        if (enemy.corpseTimeRemaining < 0.0)
            continue; // still alive
        enemy.corpseTimeRemaining -= dtSeconds;
        if (enemy.corpseTimeRemaining > 0.0)
            continue;

        Character *character = enemy.character;
        m_enemies.removeAt(i);
        destroyEntity(character);
    }
}

void GameScene::updatePartyAI(qreal dtSeconds)
{
    Character *controlled = controlledCharacter();
    if (!controlled)
        return;

    // feetPos(), not sceneBoundingRect().center() - pathfinding tile
    // lookups need to agree with where Character::tick()'s own collision
    // checks think the character is (feet-anchored), or the BFS start/goal
    // cell can land a row or more off from the character's real position
    // for a tall sprite, quietly steering it toward the wrong tile.
    const QPointF playerFeet = controlled->feetPos();
    const bool playerDead = controlled->isDead();
    updateLeaderTrail(controlled, dtSeconds);
    const bool leaderStill = m_leaderStillSeconds >= kPartyCrowdSettleSeconds;
    // Companions match the player's own run/walk pace (not the fixed
    // kPartyFollowFallbackSpeed multiplier alone) so they don't lag behind
    // every time the player sprints, but each gets its own small, fixed
    // (per-name, not re-rolled every tick) variation so a multi-companion
    // party reads as several individuals pacing themselves, not one
    // uniform block moving in lockstep.
    const qreal runMultiplier = controlled->isRunning() ? kPartyRunSpeedMultiplier : 1.0;

    int followerIndex = 0;
    for (Character *character : std::as_const(m_party)) {
        if (character == controlled) {
            // A follower that was mid-shuffle when control switched to it
            // would otherwise keep reserving that spot against everyone
            // else's spacing checks for as long as it leads.
            m_partyPaths[character].hasShuffleTarget = false;
            continue;
        }

        qreal &attackCooldown = m_partyAttackCooldowns[character];
        if (attackCooldown > 0.0)
            attackCooldown -= dtSeconds;

        if (character->isDead() || character->isActing()) {
            if (character->isDead())
                m_partyPaths[character].hasShuffleTarget = false;
            ++followerIndex;
            continue;
        }

        if (playerDead) {
            // No leader to fight for or follow - stand down rather than
            // keep charging into enemies alone.
            character->setVelocity(QPointF(0, 0));
            ++followerIndex;
            continue;
        }

        const qreal speedMultiplier = runMultiplier * partySpeedVariationFor(character->name());
        // feetPos(), not sceneBoundingRect().center() - this scan runs for
        // every (follower, enemy) pair every tick, and sceneBoundingRect()
        // does real transform-matrix work internally to map an item's local
        // rect through its full scene transform; a real `perf record`
        // during a multi-companion soak showed that cost (QTransform::type/
        // operator*=/mapRect, QGraphicsPixmapItem::boundingRect, etc.) as a
        // measurable, avoidable slice of total CPU time. feetPos() is just
        // pos() + a constant offset - a plain point, no transform math -
        // and ranking/distance purposes don't need torso-center precision.
        const QPointF selfFeet = character->feetPos();

        Enemy *nearestEnemy = nullptr;
        qreal nearestDistance = kPartyEngageRadius;
        for (Enemy &enemy : m_enemies) {
            if (enemy.character->isDead())
                continue;
            const QPointF delta = enemy.character->feetPos() - selfFeet;
            const qreal distance = std::hypot(delta.x(), delta.y());
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestEnemy = &enemy;
            }
        }

        if (nearestEnemy) {
            const QPointF delta = nearestEnemy->character->feetPos() - selfFeet;
            const qreal distance = std::hypot(delta.x(), delta.y());
            if (distance <= kPartyAttackRadius) {
                character->setVelocity(QPointF(0, 0));
                if (attackCooldown <= 0.0) {
                    character->triggerAttack();
                    playCreatureSound(character->name(), QStringLiteral("roar"));
                    if (character->isWithinMeleeReach(nearestEnemy->character->feetPos(), kPartyAttackReach)) {
                        nearestEnemy->character->applyDamage(attackDamageFor(character->strength(), kPlayerAttackDamage));
                        m_audio.playSound(nearestEnemy->character->isDead() ? QStringLiteral("death") : QStringLiteral("hit"));
                        if (nearestEnemy->character->isDead())
                            awardEnemyDefeatRewards(*nearestEnemy);
                    }
                    attackCooldown = kPartyAttackCooldown;
                }
            } else {
                const qreal chaseSpeed = moveSpeedFor(character->speed(), kPartyFollowFallbackSpeed) * speedMultiplier
                    * partyCatchUpMultiplier(distance);
                moveAlongPath(character, m_partyPaths[character], nearestEnemy->character->feetPos(), chaseSpeed, dtSeconds);
            }
            m_partyPaths[character].hasShuffleTarget = false;
            ++followerIndex;
            continue;
        }

        // No enemy nearby - follow the controlled character along its trail,
        // or, once it has stopped, mill about near it. The catch-up boost
        // is keyed on distance to the *player*, not to this follower's own
        // trail slot - a companion that's still close to the leader
        // shouldn't get a speed boost just because its particular slot
        // happens to be a bit further back.
        PartyPath &path = m_partyPaths[character];
        const QPointF toPlayer = playerFeet - selfFeet;
        const qreal distanceToPlayer = std::hypot(toPlayer.x(), toPlayer.y());
        const qreal followSpeed = moveSpeedFor(character->speed(), kPartyFollowFallbackSpeed) * speedMultiplier
            * partyCatchUpMultiplier(distanceToPlayer);
        const qreal slotArc = (followerIndex + 1) * kPartyTrailSlotSpacing;

        // Crowd membership needs a clear line to the leader - a follower
        // just around a corner from it is still lining up along the trail.
        const bool inCrowd = leaderStill
            && std::abs(toPlayer.x()) <= kPartyCrowdRadiusX && std::abs(toPlayer.y()) <= kPartyCrowdRadiusY
            && isSegmentWalkable(selfFeet, playerFeet);
        if (inCrowd)
            shuffleInCrowd(character, path, playerFeet, dtSeconds);
        else
            followTrail(character, path, playerFeet, leaderStill ? std::min(slotArc, kPartyCrowdGatherArc) : slotArc,
                        followSpeed, leaderStill, dtSeconds);
        ++followerIndex;
    }
}

void GameScene::updateLeaderTrail(Character *leader, qreal dtSeconds)
{
    const QPointF feet = leader->feetPos();
    const QPointF moved = feet - m_lastLeaderFeet;
    const qreal movedDistance = std::hypot(moved.x(), moved.y());
    const bool jumped = movedDistance > kPartyTrailTeleportDistance;
    if (leader != m_trailLeader || jumped || m_leaderTrail.isEmpty()) {
        m_trailLeader = leader;
        m_leaderTrail.clear();
        m_leaderTrail.append(feet);
        m_lastLeaderFeet = feet;
        m_leaderHeading = QPointF(0, 0);
        m_trailTailLength = 0.0;
        // Assume the new leader is standing still: if it isn't, the very
        // next tick says so. Starting at zero instead put every follower
        // through a spurious "leader is moving" spell (half a second of
        // running for a line-up that the leader's next pause immediately
        // undid) each time control switched or a level loaded.
        m_leaderStillSeconds = kPartyCrowdSettleSeconds;
        return;
    }

    // Position, not velocity: a leader shoving against a wall is standing
    // still as far as the party can tell.
    if (movedDistance < 1.0) {
        m_leaderStillSeconds += dtSeconds;
    } else {
        m_leaderStillSeconds = 0.0;
        m_leaderHeading = moved / movedDistance;
    }
    m_lastLeaderFeet = feet;

    const QPointF sinceSample = feet - m_leaderTrail.last();
    if (std::hypot(sinceSample.x(), sinceSample.y()) >= kPartyTrailSampleSpacing)
        m_leaderTrail.append(feet);

    // Every sample is at least kPartyTrailSampleSpacing from the last, so
    // this many cover the furthest slot (plus a little slack) at minimum.
    const int maxSamples = static_cast<int>(std::ceil(m_party.size() * kPartyTrailSlotSpacing / kPartyTrailSampleSpacing)) + 4;
    if (m_leaderTrail.size() > maxSamples)
        m_leaderTrail.remove(0, m_leaderTrail.size() - maxSamples);

    // Only a freshly started trail is short of the furthest slot, and only
    // for as long as it takes the leader to walk that far - skip the
    // sweep below the rest of the time.
    const qreal needed = m_party.size() * kPartyTrailSlotSpacing;
    qreal recorded = 0.0;
    QPointF previous = feet;
    for (int i = m_leaderTrail.size() - 1; i >= 0 && recorded < needed; --i) {
        recorded += std::hypot(previous.x() - m_leaderTrail.at(i).x(), previous.y() - m_leaderTrail.at(i).y());
        previous = m_leaderTrail.at(i);
    }
    if (recorded >= needed) {
        m_trailTailLength = 0.0;
        return;
    }
    const QPointF oldest = m_leaderTrail.first();
    QPointF back = m_leaderTrail.size() >= 2 ? oldest - m_leaderTrail.at(1) : oldest - feet;
    qreal backLength = std::hypot(back.x(), back.y());
    if (backLength < 0.5) {
        back = -m_leaderHeading;
        backLength = std::hypot(back.x(), back.y());
    }
    if (backLength < 0.5) {
        back = QPointF(0, -1); // never moved: behind is arbitrary, so pick up-screen
        backLength = 1.0;
    }
    m_trailTailDir = back / backLength;
    // One pass outward from the oldest point until the first wall - a
    // straight ray is walkable up to some length and then not, so there's
    // no need to test candidate lengths against each other.
    qreal length = 0.0;
    const qreal limit = std::min(needed - recorded, kPartyTrailTailMax);
    while (length + kPartySegmentSampleStep <= limit) {
        const QPointF p = oldest + m_trailTailDir * (length + kPartySegmentSampleStep);
        if (!m_map.isWalkable(p.x(), p.y()) || m_blockingAreas.containsPoint(p.x(), p.y()))
            break;
        length += kPartySegmentSampleStep;
    }
    m_trailTailLength = length;
}

QPointF GameScene::trailPointAtArc(QPointF leaderFeet, qreal arc, bool allowTail, int &olderIndex) const
{
    QPointF previous = leaderFeet;
    qreal remaining = arc;
    for (int i = m_leaderTrail.size() - 1; i >= 0; --i) {
        const QPointF sample = m_leaderTrail.at(i);
        const QPointF segment = sample - previous;
        const qreal length = std::hypot(segment.x(), segment.y());
        if (length >= remaining && length > 0.0) {
            olderIndex = i;
            return previous + segment * (remaining / length);
        }
        remaining -= length;
        previous = sample;
    }
    olderIndex = -1;
    // Past the oldest sample (previous is now that sample, or the leader
    // itself for an empty trail).
    return allowTail ? previous + m_trailTailDir * std::min(remaining, m_trailTailLength) : previous;
}

bool GameScene::isSegmentWalkable(QPointF from, QPointF to) const
{
    const QPointF delta = to - from;
    const int steps = std::max(1, static_cast<int>(std::ceil(std::hypot(delta.x(), delta.y()) / kPartySegmentSampleStep)));
    for (int i = 1; i <= steps; ++i) {
        const QPointF p = from + delta * (static_cast<qreal>(i) / steps);
        if (!m_map.isWalkable(p.x(), p.y()) || m_blockingAreas.containsPoint(p.x(), p.y()))
            return false;
    }
    return true;
}

bool GameScene::followTrail(Character *character, PartyPath &pathState, QPointF leaderFeet, qreal arc, qreal speed,
                            bool leaderStill, qreal dtSeconds)
{
    pathState.hasShuffleTarget = false;
    const QPointF selfFeet = character->feetPos();
    int olderIndex = -1;
    // The virtual tail is for a leader that's walking: a still leader's
    // followers are gathering around it, and a spot in the air behind a
    // leader that has never moved isn't somewhere worth gathering at.
    const QPointF slot = trailPointAtArc(leaderFeet, arc, !leaderStill, olderIndex);

    const QPointF toSlot = slot - selfFeet;
    const QPointF fromLeader = selfFeet - leaderFeet;
    const qreal distanceToSlot = std::hypot(toSlot.x(), toSlot.y());
    const qreal distanceToLeader = std::hypot(fromLeader.x(), fromLeader.y());

    // Stopping is decided with separate enter/exit thresholds. A follower
    // keeping pace with the leader hovers right at any single threshold
    // and, without the gap, flipped between stopped and moving every tick
    // or two - each stopped tick resets Character's walk cycle to frame 0,
    // so the animation never got past its first frame or two.
    if (leaderStill) {
        // Fixed slot: arrive, and hold until something pushes it away.
        if (pathState.trailHolding)
            pathState.trailHolding = distanceToSlot <= kPartyTrailSlotHoldExit;
        else
            pathState.trailHolding = distanceToSlot <= kPartyTrailSlotTolerance;
    } else {
        // Sliding slot: never stop for it (see the speed easing below). The
        // one reason to wait is standing in the leader's path - ahead of it
        // or alongside - where the slot is behind the leader and walking
        // there means turning around through it. Wait for it to pass.
        const bool inTheWay = distanceToLeader <= (pathState.trailHolding ? kPartyTrailLeaderHoldExit : kPartyFollowStopRadius)
            && QPointF::dotProduct(fromLeader, m_leaderHeading) > -kPartyTrailPassMargin;
        pathState.trailHolding = inTheWay;
    }
    if (pathState.trailHolding) {
        character->setVelocity(QPointF(0, 0));
        pathState.waypoints.clear();
        pathState.trailStuckTimer = 0.0;
        return true;
    }

    if (pathState.trailSuppressSeconds > 0.0)
        pathState.trailSuppressSeconds -= dtSeconds;
    if (pathState.trailSuppressSeconds <= 0.0) {
        // Steer for the point of the trail nearest the slot that's in a
        // straight walkable line from here: the slot itself if it's
        // visible, otherwise the newest earlier trail point that is (the
        // corner the follower still has to round, say). The choice is
        // only refreshed every kPartyTrailSteerRefreshSeconds; between
        // refreshes the follower keeps heading for the same target.
        pathState.trailSteerCooldown -= dtSeconds;
        if (!pathState.hasTrailSteer || pathState.trailSteerCooldown <= 0.0) {
            pathState.trailSteerCooldown = kPartyTrailSteerRefreshSeconds;
            pathState.hasTrailSteer = false;
            if (isSegmentWalkable(selfFeet, slot)) {
                pathState.hasTrailSteer = true;
                pathState.trailSteerIsSlot = true;
            } else {
                const int oldest = std::max(0, olderIndex - kPartyTrailMaxScanSamples + 1);
                for (int i = olderIndex; i >= oldest; --i) {
                    if (isSegmentWalkable(selfFeet, m_leaderTrail.at(i))) {
                        pathState.hasTrailSteer = true;
                        pathState.trailSteerIsSlot = false;
                        pathState.trailSteerPoint = m_leaderTrail.at(i);
                        break;
                    }
                }
            }
        }

        if (pathState.hasTrailSteer) {
            const QPointF steer = pathState.trailSteerIsSlot ? slot : pathState.trailSteerPoint;
            pathState.waypoints.clear(); // any A* route from an earlier fallback is moot now
            pathState.trailStuckTimer += dtSeconds;
            if (pathState.trailStuckTimer >= kPartyStuckSeconds) {
                const QPointF progress = selfFeet - pathState.trailProgressAnchor;
                if (std::hypot(progress.x(), progress.y()) < kPartyStuckProgressThreshold) {
                    pathState.trailSuppressSeconds = kPartyTrailSuppressSeconds;
                    pathState.hasTrailSteer = false;
                }
                pathState.trailProgressAnchor = selfFeet;
                pathState.trailStuckTimer = 0.0;
            }

            // Ease off near the slot rather than stopping short of it, so a
            // follower that has caught up settles into a slightly slower
            // stride behind a moving leader instead of stop-start.
            const qreal easing = std::clamp(distanceToSlot / kPartyTrailSlowRadius, kPartyTrailMinSpeedFactor, 1.0);
            const QPointF toSteer = steer - selfFeet;
            const qreal distance = std::hypot(toSteer.x(), toSteer.y());
            if (distance > 1.0)
                character->setVelocity(toSteer / distance * (speed * easing));
            else
                character->setVelocity(m_leaderHeading * (speed * easing)); // on the spot: keep going with the leader
            return false;
        }
        // Nothing on the trail is reachable from here - off the trail after
        // a fight or a control switch, or a barrier went up across it.
        pathState.trailSuppressSeconds = kPartyTrailRetrySeconds;
    }

    pathState.hasTrailSteer = false;
    pathState.trailStuckTimer = 0.0;
    pathState.trailProgressAnchor = selfFeet;
    moveAlongPath(character, pathState, slot, speed, dtSeconds);
    return false;
}

bool GameScene::violatesCrowdSpacing(QPointF point, const Character *self, bool includeShuffleTargets) const
{
    const auto conflicts = [point](QPointF other) {
        return std::abs(point.x() - other.x()) < kPartyCrowdSpacingX && std::abs(point.y() - other.y()) < kPartyCrowdSpacingY;
    };
    for (Character *member : std::as_const(m_party)) {
        if (member == self || member->isDead())
            continue;
        if (conflicts(member->feetPos()))
            return true;
        if (includeShuffleTargets) {
            const auto it = m_partyPaths.constFind(member);
            if (it != m_partyPaths.constEnd() && it->hasShuffleTarget && conflicts(it->shuffleTarget))
                return true;
        }
    }
    return false;
}

void GameScene::shuffleInCrowd(Character *character, PartyPath &pathState, QPointF leaderFeet, qreal dtSeconds)
{
    pathState.waypoints.clear();
    pathState.trailStuckTimer = 0.0;
    QRandomGenerator &rng = *QRandomGenerator::global();
    const QPointF selfFeet = character->feetPos();
    const bool overlapping = violatesCrowdSpacing(selfFeet, character, false);

    if (pathState.hasShuffleTarget) {
        pathState.shuffleTimer -= dtSeconds;
        const QPointF toTarget = pathState.shuffleTarget - selfFeet;
        const qreal distance = std::hypot(toTarget.x(), toTarget.y());
        if (distance > kPartyShuffleArriveRadius && pathState.shuffleTimer > 0.0
            && isSegmentWalkable(selfFeet, pathState.shuffleTarget)) {
            const qreal speed = moveSpeedFor(character->speed(), kPartyFollowFallbackSpeed) * kPartyShuffleSpeedFactor;
            character->setVelocity(QPointF(toTarget.x() / distance * speed, toTarget.y() / distance * speed));
            return;
        }
        pathState.hasShuffleTarget = false;
        pathState.shuffleWaitingRetry = false;
        pathState.shuffleTimer = kPartyShufflePauseMinSeconds
            + rng.generateDouble() * (kPartyShufflePauseMaxSeconds - kPartyShufflePauseMinSeconds);
    } else if (pathState.shuffleTimer > 0.0) {
        pathState.shuffleTimer -= dtSeconds;
    }

    character->setVelocity(QPointF(0, 0));
    // An overlapping follower skips the idle pause, but not the retry delay
    // after a failed search - otherwise one boxed-in enough to find no
    // valid step would rerun the whole candidate search every tick.
    if (pathState.shuffleTimer > 0.0 && (!overlapping || pathState.shuffleWaitingRetry))
        return;

    // How far out in the crowd area a point is: 0 at the leader, 1 at the
    // edge of the area.
    const auto crowdDepth = [leaderFeet](QPointF p) {
        return std::max(std::abs(p.x() - leaderFeet.x()) / kPartyCrowdRadiusX,
                        std::abs(p.y() - leaderFeet.y()) / kPartyCrowdRadiusY);
    };
    const qreal selfDepth = crowdDepth(selfFeet);
    for (int attempt = 0; attempt < kPartyShuffleCandidateTries; ++attempt) {
        const qreal angle = rng.generateDouble() * 2.0 * M_PI;
        const qreal step = kPartyShuffleMinStep + rng.generateDouble() * (kPartyShuffleMaxStep - kPartyShuffleMinStep);
        const QPointF candidate = selfFeet + QPointF(std::cos(angle) * step, std::sin(angle) * step);
        const qreal depth = crowdDepth(candidate);
        // A follower that just arrived at the edge works its way inward
        // rather than drifting about out there; once inside, any step that
        // stays in the area is fine.
        if (depth > kPartyCrowdOuterFraction || (selfDepth > kPartyCrowdInnerFraction && depth >= selfDepth))
            continue;
        if (violatesCrowdSpacing(candidate, character, true) || !isSegmentWalkable(selfFeet, candidate))
            continue;
        pathState.hasShuffleTarget = true;
        pathState.shuffleWaitingRetry = false;
        pathState.shuffleTarget = candidate;
        pathState.shuffleTimer = kPartyShuffleMaxWalkSeconds;
        return;
    }
    pathState.shuffleWaitingRetry = true;
    pathState.shuffleTimer = kPartyShuffleRetrySeconds; // nothing fit this time - try again shortly
}

void GameScene::moveAlongPath(Character *character, PartyPath &pathState, QPointF targetWorld, qreal speed, qreal dtSeconds)
{
    if (pathState.repathCooldown > 0.0)
        pathState.repathCooldown -= dtSeconds;

    const QPointF selfFeet = character->feetPos();
    const QPointF targetDelta = targetWorld - pathState.targetWorld;
    const bool targetMovedFar = std::hypot(targetDelta.x(), targetDelta.y()) > kPartyRepathTargetMoveDistance;

    bool forceRepath = false;
    if (!pathState.waypoints.isEmpty()) {
        const QPointF delta = pathState.waypoints.first() - selfFeet;
        const qreal distanceToWaypoint = std::hypot(delta.x(), delta.y());
        if (pathState.lastWaypointDistance >= 0.0
            && distanceToWaypoint > pathState.lastWaypointDistance - kPartyStuckProgressThreshold) {
            pathState.stuckTimer += dtSeconds;
        } else {
            pathState.stuckTimer = 0.0;
        }
        pathState.lastWaypointDistance = distanceToWaypoint;
        if (pathState.stuckTimer > kPartyStuckSeconds) {
            forceRepath = true;
            pathState.stuckTimer = 0.0;
            pathState.lastWaypointDistance = -1.0;

            // A repath alone doesn't help if the grid findPath() searches
            // over still calls this same cell walkable (see
            // m_temporarilyBlockedCells) - it would just hand back the
            // identical path into the identical wedge. Blacklist the
            // waypoint that wasn't actually reachable so the next search
            // is forced around it instead.
            const int tileW = m_map.tileWidth();
            const int tileH = m_map.tileHeight();
            if (tileW > 0 && tileH > 0) {
                const QPointF stuckWaypoint = pathState.waypoints.first();
                const QPoint stuckCell(static_cast<int>(stuckWaypoint.x()) / tileW,
                                       static_cast<int>(stuckWaypoint.y()) / tileH);
                m_temporarilyBlockedCells.insert(stuckCell, kTemporaryBlockSeconds);
            }
        }
    }

    if (forceRepath || pathState.waypoints.isEmpty() || (pathState.repathCooldown <= 0.0 && targetMovedFar)) {
        pathState.waypoints = findPath(selfFeet, targetWorld);
        pathState.targetWorld = targetWorld;
        pathState.repathCooldown = kPartyRepathInterval;
    }

    // Drop any waypoints already reached - both a fresh path's leading
    // cells (rare, but harmless if the mover's own tile snuck in) and ones
    // reached since the last time this ran.
    while (!pathState.waypoints.isEmpty()) {
        const QPointF delta = pathState.waypoints.first() - selfFeet;
        if (std::hypot(delta.x(), delta.y()) > kPartyWaypointArriveRadius)
            break;
        pathState.waypoints.removeFirst();
    }

    // No path found (unreachable, or the search hit its node cap) - a
    // direct line is still better than standing frozen, and real collision
    // will stop it from actually walking through anything solid.
    const QPointF nextStop = pathState.waypoints.isEmpty() ? targetWorld : pathState.waypoints.first();
    const QPointF toStop = nextStop - selfFeet;
    const qreal distance = std::hypot(toStop.x(), toStop.y());
    if (distance > 1.0)
        character->setVelocity(QPointF(toStop.x() / distance * speed, toStop.y() / distance * speed));
    else
        character->setVelocity(QPointF(0, 0));
}

QVector<QPointF> GameScene::findPath(QPointF fromWorld, QPointF toWorld) const
{
    const int tileW = m_map.tileWidth();
    const int tileH = m_map.tileHeight();
    if (tileW <= 0 || tileH <= 0)
        return {};

    auto toCell = [tileW, tileH](QPointF p) {
        return QPoint(static_cast<int>(p.x()) / tileW, static_cast<int>(p.y()) / tileH);
    };
    auto cellCenter = [tileW, tileH](QPoint c) {
        return QPointF(c.x() * tileW + tileW / 2.0, c.y() * tileH + tileH / 2.0);
    };

    const QPoint start = toCell(fromWorld);
    const QPoint goal = toCell(toWorld);
    if (start == goal)
        return {};

    // A* (Manhattan-distance heuristic), not plain BFS - a following/
    // chasing companion's target keeps moving further away as it runs,
    // and BFS explores in uniform rings regardless of which direction the
    // goal is actually in. On a real chase (goal tens of tiles away), that
    // ring exploration was hitting kPathfindMaxExpansions and returning
    // "no path found" long before it ever reached a genuinely reachable
    // goal, stranding the companion on the straight-line fallback (see
    // moveAlongPath) it was specifically added to avoid. A* biases
    // expansion toward the goal, so the same distant target is found in a
    // small fraction of the node visits. 4-directional only, no diagonals
    // - diagonal steps would cut across wall corners in a grid-aligned
    // maze built from tile-wide corridors.
    static const QPoint kDirections[4] = { QPoint(1, 0), QPoint(-1, 0), QPoint(0, 1), QPoint(0, -1) };
    auto heuristic = [&goal](QPoint p) { return std::abs(p.x() - goal.x()) + std::abs(p.y() - goal.y()); };

    struct OpenNode
    {
        int f;
        QPoint pos;
    };
    struct OpenNodeCompare
    {
        bool operator()(const OpenNode &a, const OpenNode &b) const { return a.f > b.f; }
    };

    std::priority_queue<OpenNode, std::vector<OpenNode>, OpenNodeCompare> openSet;
    QHash<QPoint, QPoint> cameFrom;
    QHash<QPoint, int> bestCost;

    cameFrom.insert(start, start);
    bestCost.insert(start, 0);
    openSet.push({ heuristic(start), start });

    bool found = false;
    int expansions = 0;
    while (!openSet.empty() && expansions < kPathfindMaxExpansions) {
        const QPoint current = openSet.top().pos;
        openSet.pop();
        ++expansions;
        if (current == goal) {
            found = true;
            break;
        }
        const int currentCost = bestCost.value(current);

        for (const QPoint &dir : kDirections) {
            const QPoint next = current + dir;
            // The goal cell is always accepted even if its own tile-center
            // nominally reads as blocked (e.g. a target standing right at
            // the edge of a wall) - the point is to get close, not to
            // literally stand on that exact pixel.
            if (next != goal) {
                const QPointF center = cellCenter(next);
                const bool blocked = !m_map.isWalkable(center.x(), center.y())
                    || m_blockingAreas.containsPoint(center.x(), center.y())
                    || m_temporarilyBlockedCells.contains(next);
                if (blocked)
                    continue;
            }
            const int tentativeCost = currentCost + 1;
            if (bestCost.contains(next) && tentativeCost >= bestCost.value(next))
                continue;
            bestCost.insert(next, tentativeCost);
            cameFrom.insert(next, current);
            openSet.push({ tentativeCost + heuristic(next), next });
        }
    }

    if (!found)
        return {};

    QVector<QPoint> cellPath;
    QPoint cur = goal;
    while (cur != start) {
        cellPath.append(cur);
        cur = cameFrom.value(cur);
    }
    std::reverse(cellPath.begin(), cellPath.end());

    QVector<QPointF> waypoints;
    waypoints.reserve(cellPath.size());
    for (const QPoint &cell : cellPath)
        waypoints.append(cellCenter(cell));
    return waypoints;
}

void GameScene::updateEnemyAI(qreal dtSeconds)
{
    Character *player = controlledCharacter();
    if (!player)
        return;

    // feetPos(), not sceneBoundingRect().center() - see Character::feetPos()'s
    // own comment, and interactWithNearby()'s identical fix.
    const QPointF playerCenter = player->feetPos();

    for (Enemy &enemy : m_enemies) {
        Character *character = enemy.character;

        if (enemy.attackCooldownRemaining > 0.0)
            enemy.attackCooldownRemaining -= dtSeconds;

        if (character->isDead() || character->isActing())
            continue;

        if (player->isDead()) {
            character->setVelocity(QPointF(0, 0));
            continue;
        }

        const QPointF enemyCenter = character->feetPos();
        const QPointF delta = playerCenter - enemyCenter;
        const qreal distance = std::hypot(delta.x(), delta.y());

        if (distance <= kEnemyAttackRadius) {
            character->setVelocity(QPointF(0, 0));
            if (enemy.attackCooldownRemaining <= 0.0) {
                character->triggerAttack();
                playCreatureSound(character->name(), QStringLiteral("roar"));
                if (character->isWithinMeleeReach(player->feetPos(), kEnemyAttackReach)) {
                    player->applyDamage(attackDamageFor(character->strength(), kEnemyAttackDamage));
                    m_audio.playSound(player->isDead() ? QStringLiteral("death") : QStringLiteral("hit"));
                    if (player->isDead())
                        notifyPlayerDeathIfNeeded();
                }
                enemy.attackCooldownRemaining = kEnemyAttackCooldown;
            }
        } else if (distance <= kEnemyDetectRadius) {
            const qreal chaseSpeed = moveSpeedFor(character->speed(), kEnemyChaseSpeed);
            character->setVelocity(QPointF(delta.x() / distance * chaseSpeed, delta.y() / distance * chaseSpeed));
        } else {
            character->setVelocity(QPointF(0, 0));
        }
    }
}

void GameScene::updateFireballCasting(qreal dtSeconds)
{
    for (auto it = m_fireballCooldowns.begin(); it != m_fireballCooldowns.end(); ++it) {
        if (it.value() > 0.0)
            it.value() -= dtSeconds;
    }

    // Party casters - every member EXCEPT whichever one is currently
    // controlled, the same split melee already has (updatePartyAI() fights
    // automatically for followers; the controlled character only swings on
    // Ctrl, via triggerPlayerAttack()). The controlled character's own
    // casting is manual-only (F, see triggerPlayerFireball()) for exactly
    // the reason that split exists for melee: if this loop cast for them
    // too, it would claim the shared cooldown the instant it's ready, every
    // time, every tick - the player's own key press would then almost
    // always land on "still on cooldown" from a cast they didn't ask for a
    // moment earlier, making the button read as broken even though it's
    // wired up correctly.
    Character *controlled = controlledCharacter();
    for (Character *caster : std::as_const(m_party)) {
        if (caster == controlled)
            continue;
        if (caster->isDead() || caster->isActing())
            continue;
        if (caster->intelligence() < kFireballMinIntelligence)
            continue;
        if (m_fireballCooldowns.value(caster, 0.0) > 0.0)
            continue;

        Enemy *nearestEnemy = nearestLivingEnemyInRange(caster->feetPos(), kFireballCastRadius);
        if (!nearestEnemy)
            continue;

        castFireball(caster, nearestEnemy->character, /*targetIsEnemy=*/true);
        m_fireballCooldowns[caster] = fireballCooldownFor(caster->intelligence());
    }

    // Hostile casters - always aim at the controlled character specifically,
    // the same restriction updateEnemyAI()'s own melee AI already has
    // (hostiles never target a following, non-controlled companion at all
    // today - see its `Character *player = controlledCharacter()`). Most of
    // the roster falls well short of kFireballMinIntelligence anyway (see
    // its own comment), so in practice this only ever fires for the real
    // spellcaster archetypes.
    if (controlled && !controlled->isDead()) {
        const QPointF playerFeet = controlled->feetPos();
        for (Enemy &enemy : m_enemies) {
            Character *caster = enemy.character;
            if (caster->isDead() || caster->isActing())
                continue;
            if (caster->intelligence() < kFireballMinIntelligence)
                continue;
            if (m_fireballCooldowns.value(caster, 0.0) > 0.0)
                continue;

            const QPointF delta = playerFeet - caster->feetPos();
            if (std::hypot(delta.x(), delta.y()) > kFireballCastRadius)
                continue;

            castFireball(caster, controlled, /*targetIsEnemy=*/false);
            m_fireballCooldowns[caster] = fireballCooldownFor(caster->intelligence());
        }
    }
}

GameScene::Enemy *GameScene::nearestLivingEnemyInRange(QPointF fromFeet, qreal maxRange)
{
    Enemy *nearest = nullptr;
    qreal nearestDistance = maxRange;
    for (Enemy &enemy : m_enemies) {
        if (enemy.character->isDead())
            continue;
        const QPointF delta = enemy.character->feetPos() - fromFeet;
        const qreal distance = std::hypot(delta.x(), delta.y());
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = &enemy;
        }
    }
    return nearest;
}

void GameScene::triggerPlayerFireball()
{
    Character *player = controlledCharacter();
    if (!player || player->isDead() || player->isActing())
        return;
    if (player->intelligence() < kFireballMinIntelligence) {
        // Unlike the other no-ops below (on cooldown, nothing in range -
        // both self-explanatory once you already know the system exists),
        // this one is worth a message: it's the only reason pressing the
        // key could seemingly do nothing FOREVER for a given character, so
        // silence here would read as "the button is broken" rather than
        // "this character can't do that (yet)".
        showInfoMessage(QStringLiteral("Magic"),
                         QStringLiteral("%1 isn't intelligent enough to cast fireballs yet.")
                             .arg(prettifyRosterName(player->name())));
        return;
    }
    if (m_fireballCooldowns.value(player, 0.0) > 0.0)
        return; // still on cooldown - mashing the key can't shorten the interval intelligence buys

    Enemy *nearestEnemy = nearestLivingEnemyInRange(player->feetPos(), kFireballCastRadius);
    if (!nearestEnemy)
        return; // nothing in range to aim at

    castFireball(player, nearestEnemy->character, /*targetIsEnemy=*/true);
    m_fireballCooldowns[player] = fireballCooldownFor(player->intelligence());
}

void GameScene::castFireball(Character *caster, Character *target, bool targetIsEnemy)
{
    caster->triggerSkill();
    playCreatureSound(caster->name(), QStringLiteral("roar"));

    // Launched from roughly chest/hand height, not the ground at the feet -
    // the midpoint between feetPos() and the sprite's own vertical center
    // (half its frame height). feetPos() - pos() recovers Character's
    // private feetOffset() without needing a new accessor for it (feetPos()
    // is defined as exactly pos() + feetOffset()).
    const QPointF localFeet = caster->feetPos() - caster->pos();
    const qreal frameMidY = caster->boundingRect().height() / 2.0;
    const QPointF start = caster->pos() + QPointF(localFeet.x(), (localFeet.y() + frameMidY) / 2.0);
    // Snapshotting the target's position now rather than re-tracking a
    // moving target over the flight - the bolt is fast and the flight is
    // short (see kFireballSpeed), so a target that ran a few steps in that
    // window reading as "just barely dodged it" is the intended feel, not
    // a bug to compensate for.
    const QPointF end = target->feetPos();
    const qreal distance = std::hypot(end.x() - start.x(), end.y() - start.y());
    const qreal duration = std::max(0.12, distance / kFireballSpeed);
    const int intelligence = caster->intelligence();

    new FireballItem(this, start, end, duration, intelligence); // self-removing - see its own header

    PendingFireballHit hit;
    hit.timeRemaining = duration;
    hit.target = target;
    hit.targetIsEnemy = targetIsEnemy;
    hit.damage = fireballDamageFor(intelligence);
    m_pendingFireballHits.append(hit);
}

void GameScene::updatePendingFireballHits(qreal dtSeconds)
{
    for (int i = m_pendingFireballHits.size() - 1; i >= 0; --i) {
        PendingFireballHit &hit = m_pendingFireballHits[i];
        hit.timeRemaining -= dtSeconds;
        if (hit.timeRemaining > 0.0)
            continue;

        // The target may have died from something else entirely while this
        // bolt was still in flight - a no-op landing, not an error.
        if (!hit.target->isDead()) {
            hit.target->applyDamage(hit.damage);
            m_audio.playSound(hit.target->isDead() ? QStringLiteral("death") : QStringLiteral("hit"));
            if (hit.target->isDead()) {
                if (hit.targetIsEnemy) {
                    for (Enemy &enemy : m_enemies) {
                        if (enemy.character == hit.target) {
                            awardEnemyDefeatRewards(enemy);
                            break;
                        }
                    }
                } else {
                    notifyPlayerDeathIfNeeded();
                }
            }
        }
        m_pendingFireballHits.removeAt(i);
    }
}

void GameScene::toggleHealthBarDisplay()
{
    switch (m_healthBarDisplay) {
    case HealthBarDisplay::HeroOnly:
        m_healthBarDisplay = HealthBarDisplay::All;
        break;
    case HealthBarDisplay::All:
        m_healthBarDisplay = HealthBarDisplay::None;
        break;
    case HealthBarDisplay::None:
        m_healthBarDisplay = HealthBarDisplay::HeroOnly;
        break;
    }
    applyHealthBarDisplay();
}

namespace {
// Same 10 rows every character sheet follows (see the LARASPRITE pipeline
// notes) - idle/walk/run aren't normally driven through startAction() in
// real gameplay (Character::updatePixmap() picks those from velocity/
// running state instead), but startAction() works uniformly for all ten
// for preview purposes since it just forces isActing() true and plays the
// named row's frames once.
const QStringList kPosePreviewRows = {
    QStringLiteral("idle"), QStringLiteral("walk"), QStringLiteral("run"),
    QStringLiteral("defend"), QStringLiteral("attack"), QStringLiteral("skill"),
    QStringLiteral("hit"), QStringLiteral("die"), QStringLiteral("dash"),
    QStringLiteral("jump"),
};
constexpr qreal kPosePreviewSecondsPerRow = 1.8;
}

void GameScene::togglePosePreview()
{
    m_posePreviewActive = !m_posePreviewActive;
    if (!m_posePreviewActive) {
        m_posePreviewRowIndex = -1;
        m_posePreviewElapsed = 0.0;
        return;
    }
    m_posePreviewRowIndex = 0;
    m_posePreviewElapsed = 0.0;
    if (Character *character = controlledCharacter()) {
        character->setVelocity(QPointF(0, 0));
        character->playPreviewAction(kPosePreviewRows.at(m_posePreviewRowIndex));
    }
}

void GameScene::applyHealthBarDisplay()
{
    for (int i = 0; i < m_party.size(); ++i) {
        const bool visible = m_healthBarDisplay == HealthBarDisplay::All
            || (m_healthBarDisplay == HealthBarDisplay::HeroOnly && i == m_controlledIndex);
        m_party.at(i)->setHealthBarVisible(visible);
    }
    for (const Enemy &enemy : std::as_const(m_enemies))
        enemy.character->setHealthBarVisible(m_healthBarDisplay == HealthBarDisplay::All);
}

bool GameScene::isDialogueActive() const
{
    return m_scriptEngine.isPausedOnDialogue() || m_engineMessageActive;
}

void GameScene::advanceDialogue()
{
    if (m_engineMessageActive) {
        // An engine-triggered message (see showInfoMessage()) isn't a
        // script coroutine at all - nothing for m_scriptEngine to advance.
        m_engineMessageActive = false;
        emit dialogueEnded();
        return;
    }
    m_scriptEngine.advance();
}

void GameScene::showInfoMessage(const QString &speaker, const QString &text)
{
    m_engineMessageActive = true;
    emit dialogueRequested(speaker, text);
}

bool GameScene::isScriptBusy() const
{
    return m_scriptEngine.isBusy();
}

void GameScene::stopTicking()
{
    m_tickTimer.stop();
}

void GameScene::interactWithNearby()
{
    Character *player = controlledCharacter();
    if (!player || player->isDead())
        return;
    // Without this, examining a prop mid-conversation (or mid-`wait()`)
    // could show a second, unrelated dialogue box on top of the script's
    // own - each source assumes it's the only thing driving the box.
    if (isDialogueActive())
        return;

    // feetPos(), not sceneBoundingRect().center() - see Character::feetPos()'s
    // own comment. This mattered even before, but tools/refit_sprites.py's
    // bottom-anchored padding makes the gap between the two much bigger now
    // (hundreds of pixels for a tall sprite), so using the bounding-box
    // center here made kTalkRadius=120px effectively unreachable from
    // anywhere a player would actually expect to stand.
    const QPointF playerCenter = player->feetPos();

    for (const Npc &npc : std::as_const(m_npcs)) {
        const QPointF npcCenter = npc.character->feetPos();
        const QPointF delta = playerCenter - npcCenter;
        if (std::hypot(delta.x(), delta.y()) <= kTalkRadius) {
            m_scriptEngine.callEntryPoint(QStringLiteral("onTalkTo"), { QJSValue(npc.name) });
            return; // talk to whichever one is closest enough first, not all of them at once
        }
    }

    // No NPC in range - talking always wins over examining scenery, but
    // failing that, see if there's a prop close enough to look at instead.
    for (Prop *prop : std::as_const(m_props)) {
        const QPointF propCenter = prop->pos() + prop->groundAnchorOffset();
        const QPointF delta = playerCenter - propCenter;
        if (std::hypot(delta.x(), delta.y()) <= kTalkRadius) {
            const QJsonObject entry = m_propsCatalog.value(prop->name()).toObject();
            const QString title = entry.value("name").toString(prop->name());
            const QString description = entry.value("description").toString();
            if (!description.isEmpty())
                showInfoMessage(title, description);
            return;
        }
    }
}

void GameScene::scriptSpawnCharacter(const QString &name, int tileCol, int tileRow, int hp)
{
    // Companions/NPCs are meant to exist at most once by name (unlike
    // spawnEnemy(), which legitimately spawns many same-named instances of
    // a monster type) - a second spawn under a name still tracked in
    // m_charactersByName means either a script bug (spawning without
    // despawning a prior form first) or onLevelStart genuinely running more
    // than once for this chapter. Either way, silently creating a second,
    // independent Character with the same identity is worse than refusing:
    // it reads in-game as the same person standing in two places at once,
    // each separately talkable/attackable.
    if (m_charactersByName.contains(name)) {
        qWarning() << "scriptSpawnCharacter: refusing duplicate spawn of" << name
                   << "- a character with this name already exists in the scene";
        return;
    }
    // hp<=0 from the script means "use this hero's own persisted base max
    // HP" (GameState::heroBaseMaxHp) rather than "no combat stats" (the
    // convention createCharacterAt()/createCharacterAtWorldFeet() otherwise
    // use hp<=0 for, e.g. a talk-only NPC) - see spawnCharacter()'s own
    // comment in ScriptBridge.h for why every chapter's own lara_cyber
    // spawn call is written to omit hp deliberately, rather than this being
    // a bug to guard against.
    const int effectiveHp = hp > 0 ? hp : m_state->heroBaseMaxHp;
    Character *character = createCharacterAt(name, tileCol, tileRow, effectiveHp);
    if (!character)
        return;
    m_party.append(character);
    m_charactersByName.insert(name, character);
    applyHealthBarDisplay();
    // A freshly recruited/respawned companion starts at the party's
    // current level bonuses, not base stats waiting for the next level-up.
    character->setLevelBonuses(strengthBonusForLevel(m_state->level), intelligenceBonusForLevel(m_state->level),
                                speedBonusForLevel(m_state->level));
    // Same idea for permanent item-derived bonuses (see GameState::
    // itemBonusStrength/etc and useItem()'s "permanentBoost" effect) - a
    // companion who joins after the party already drank/read/wore whatever
    // granted these still starts with the full accumulated total, not base
    // stats.
    character->setItemBonuses(m_state->itemBonusStrength, m_state->itemBonusIntelligence);
    if (m_state->itemBonusMaxHp > 0 && character->maxHp() > 0)
        character->setMaxHp(character->maxHp() + m_state->itemBonusMaxHp);
}

void GameScene::scriptSpawnEnemy(const QString &name, int tileCol, int tileRow, int hp)
{
    Character *character = createCharacterAt(name, tileCol, tileRow, hp);
    if (!character)
        return;
    m_enemies.append(Enemy{ character, name, 0.0, false });
    m_charactersByName.insert(name, character);
    applyHealthBarDisplay();
}

void GameScene::scriptSpawnNpc(const QString &name, int tileCol, int tileRow)
{
    // See the identical guard in scriptSpawnCharacter() for why - NPCs are
    // meant to exist at most once by name.
    if (m_charactersByName.contains(name)) {
        qWarning() << "scriptSpawnNpc: refusing duplicate spawn of" << name
                   << "- a character with this name already exists in the scene";
        return;
    }
    Character *character = createCharacterAt(name, tileCol, tileRow, 0);
    if (!character)
        return;
    // A little idle life instead of standing frozen in place - see
    // Character::setWanderEnabled(). Deliberately only NPCs, not party
    // members or enemies (see that method's own comment for why).
    character->setWanderEnabled(true);
    m_npcs.append(Npc{ character, name });
    m_charactersByName.insert(name, character);
}

void GameScene::scriptDespawnNpc(const QString &name)
{
    for (int i = 0; i < m_npcs.size(); ++i) {
        if (m_npcs.at(i).name != name)
            continue;
        Character *character = m_npcs.at(i).character;
        m_npcs.removeAt(i);
        destroyEntity(character);
        return;
    }
}

void GameScene::scriptSpawnItem(const QString &itemId, int tileCol, int tileRow)
{
    const qreal worldX = (tileCol + 0.5) * m_map.tileWidth();
    const qreal worldY = (tileRow + 0.5) * m_map.tileHeight();
    spawnItemInWorld(itemId, worldX, worldY);
}

QString GameScene::itemImagePath(const QJsonObject &catalogEntry) const
{
    // "image" (a dedicated assets/items/<image>.png) is preferred; "prop"
    // (an existing assets/props/<prop>.png) is the older placeholder
    // convention, kept for the handful of items that still use it.
    const QString imageName = catalogEntry.value("image").toString();
    if (!imageName.isEmpty())
        return QStringLiteral(ASSET_DIR "/items/%1.png").arg(imageName);
    return QStringLiteral(ASSET_DIR "/props/%1.png").arg(catalogEntry.value("prop").toString());
}

void GameScene::playCreatureSound(const QString &characterName, const QString &kind)
{
    const QString soundName = m_creatureSoundsCatalog.value(characterName).toObject().value(kind).toString();
    if (!soundName.isEmpty()) {
        m_audio.playSound(soundName);
        return;
    }
    if (kind == QStringLiteral("roar"))
        m_audio.playSound(QStringLiteral("attack")); // every character has *some* attack sound
    // "whistle" has no fallback - most characters simply never whistle.
}

QVector<GameScene::ItemEntry> GameScene::inventoryEntries() const
{
    QVector<ItemEntry> entries;
    for (auto it = m_state->inventory.constBegin(); it != m_state->inventory.constEnd(); ++it) {
        if (it.value() <= 0)
            continue; // removeItem clamps at 0 but never erases the key - skip anything spent out
        const QJsonObject catalogEntry = m_itemsCatalog.value(it.key()).toObject();
        if (catalogEntry.isEmpty())
            continue;
        entries.append(ItemEntry{ it.key(), catalogEntry.value("name").toString(),
                                   catalogEntry.value("description").toString(), itemImagePath(catalogEntry),
                                   it.value() });
    }
    // QHash's iteration order is seeded per-process (Qt randomizes it for
    // security, see QHashSeed) - without this, the same inventory would
    // visibly shuffle its own row order between one game launch and the
    // next. Alphabetical by display name is a stable, reasonable menu order.
    std::sort(entries.begin(), entries.end(),
              [](const ItemEntry &a, const ItemEntry &b) { return a.name < b.name; });
    return entries;
}

GameScene::SceneSnapshot GameScene::captureSnapshot() const
{
    SceneSnapshot snapshot;

    for (Character *character : std::as_const(m_party))
        snapshot.party.append(CharacterSnapshot{ character->name(), character->pos().x(), character->pos().y(),
                                                  character->hp(), character->maxHp() });
    if (Character *controlled = controlledCharacter())
        snapshot.controlledName = controlled->name();

    for (const Enemy &enemy : std::as_const(m_enemies)) {
        if (enemy.character->isDead())
            continue; // corpses aren't meaningful state to restore - see the struct's own comment
        snapshot.enemies.append(CharacterSnapshot{ enemy.name, enemy.character->pos().x(), enemy.character->pos().y(),
                                                     enemy.character->hp(), enemy.character->maxHp() });
    }

    for (const Npc &npc : std::as_const(m_npcs))
        snapshot.npcs.append(CharacterSnapshot{ npc.name, npc.character->pos().x(), npc.character->pos().y(), 0, 0 });

    for (const WorldItem &item : std::as_const(m_worldItems))
        snapshot.items.append(ItemSnapshot{ item.itemId, item.worldX, item.worldY });

    return snapshot;
}

void GameScene::restoreSnapshot(const SceneSnapshot &snapshot)
{
    // Party composition (who's even recruited) is already correct by this
    // point via GameState's *_recruited vars driving respawnCompanions() -
    // this only fixes up where each of them stands and how hurt they are,
    // matched by roster name.
    for (const CharacterSnapshot &saved : snapshot.party) {
        for (Character *character : std::as_const(m_party)) {
            if (character->name() != saved.name)
                continue;
            character->setPos(saved.x, saved.y);
            character->setCurrentHp(saved.hp);
            break;
        }
    }
    if (!snapshot.controlledName.isEmpty()) {
        for (int i = 0; i < m_party.size(); ++i) {
            if (m_party.at(i)->name() == snapshot.controlledName) {
                m_controlledIndex = i;
                break;
            }
        }
    }

    // In-flight attacks and cooldowns belong to the state being replaced,
    // including attacks against party members who survive restoration.
    // Per-entity pointer cleanup is handled separately by destroyEntity().
    m_pendingFireballHits.clear();
    m_fireballCooldowns.clear();

    // Every chapter's own dynamic spawns (hostiles/NPCs/loot) are gated
    // behind a *_spawned var, already restored before this ran - so
    // onLevelStart should have produced none of these at all. Clear
    // whatever's actually present regardless rather than relying on that
    // holding for every chapter forever, so a stray unguarded spawn can
    // never end up duplicated alongside the restored one.
    while (!m_enemies.isEmpty())
        destroyEntity(m_enemies.takeLast().character);
    while (!m_npcs.isEmpty())
        destroyEntity(m_npcs.takeLast().character);
    while (!m_worldItems.isEmpty())
        destroyEntity(m_worldItems.takeLast().prop);

    for (const CharacterSnapshot &saved : snapshot.enemies) {
        // Position is set explicitly right after, via the same raw pos()
        // convention captureSnapshot() saved it with - the (0,0) passed
        // here is a placeholder, not a real placement.
        Character *character = createCharacterAtWorldFeet(saved.name, QPointF(0, 0), saved.maxHp, false);
        if (!character)
            continue;
        character->setPos(saved.x, saved.y);
        character->setCurrentHp(saved.hp);
        m_enemies.append(Enemy{ character, saved.name, 0.0, false });
        m_charactersByName.insert(saved.name, character);
    }

    for (const CharacterSnapshot &saved : snapshot.npcs) {
        Character *character = createCharacterAtWorldFeet(saved.name, QPointF(0, 0), 0, false);
        if (!character)
            continue;
        character->setPos(saved.x, saved.y);
        character->setWanderEnabled(true);
        m_npcs.append(Npc{ character, saved.name });
        m_charactersByName.insert(saved.name, character);
    }

    for (const ItemSnapshot &saved : snapshot.items)
        spawnItemInWorld(saved.itemId, saved.x, saved.y);

    applyHealthBarDisplay();
}

void GameScene::useItem(const QString &itemId)
{
    if (m_state->inventory.value(itemId, 0) <= 0)
        return;

    const QJsonObject catalogEntry = m_itemsCatalog.value(itemId).toObject();
    if (catalogEntry.isEmpty())
        return;

    // Two built-in, engine-handled effects that work identically in every
    // chapter with no script code - anything else (no "onUse" at all, or
    // an unrecognized type) dispatches to the current chapter's own script
    // instead, for narrative/quest-specific effects (a key that does
    // something only near a particular object, etc). "consumeOnUse" only
    // applies to the built-in path - a script-dispatched item decides for
    // itself whether/when to call api.removeItem, since that decision is
    // often conditional (e.g. only once a chest is actually opened).
    const QJsonObject onUse = catalogEntry.value("onUse").toObject();
    const QString effectType = onUse.value("type").toString();
    const bool consumeOnUse = catalogEntry.value("consumeOnUse").toBool(false);
    Character *player = controlledCharacter();

    if (effectType == QStringLiteral("heal")) {
        if (player)
            player->heal(onUse.value("amount").toInt(20));
        if (consumeOnUse)
            scriptRemoveItem(itemId, 1);
    } else if (effectType == QStringLiteral("compass")) {
        if (player) {
            const QPointF feet = player->feetPos();
            const int col = static_cast<int>(feet.x() / m_map.tileWidth());
            const int row = static_cast<int>(feet.y() / m_map.tileHeight());
            showInfoMessage(catalogEntry.value("name").toString(),
                             QStringLiteral("You are near tile (%1, %2).").arg(col).arg(row));
        }
        if (consumeOnUse)
            scriptRemoveItem(itemId, 1);
    } else if (effectType == QStringLiteral("buff")) {
        // Temporary, whole-party stat buff - see Character::applyTemporary*
        // Buff(). Applied to every current party member, not just whoever's
        // controlled: a following companion's own automatic melee/fireball
        // AI (updatePartyAI()/updateFireballCasting()) reads strength()/
        // intelligence()/speed() exactly the same way the controlled
        // character's own combat does, so leaving followers out would make
        // "party speed potion" a misnomer.
        const QString stat = onUse.value("stat").toString();
        const int amount = onUse.value("amount").toInt(0);
        const qreal duration = onUse.value("durationSeconds").toDouble(30.0);
        for (Character *member : std::as_const(m_party)) {
            if (stat == QStringLiteral("speed"))
                member->applyTemporarySpeedBuff(amount, duration);
            else if (stat == QStringLiteral("intelligence"))
                member->applyTemporaryIntelligenceBuff(amount, duration);
            else if (stat == QStringLiteral("attack"))
                member->applyTemporaryStrengthBuff(amount, duration);
        }
        showInfoMessage(catalogEntry.value("name").toString(),
                         QStringLiteral("The whole party feels it - it'll fade in %1 seconds.").arg(int(duration)));
        if (consumeOnUse)
            scriptRemoveItem(itemId, 1);
    } else if (effectType == QStringLiteral("permanentBoost")) {
        // Permanent, whole-party stat increase - the running total lives in
        // GameState (see its own comment) so it survives level transitions,
        // saves, and applies to a companion who joins later too (see
        // scriptSpawnCharacter()), not just whoever's already in the party
        // right now.
        const QString stat = onUse.value("stat").toString();
        const int amount = onUse.value("amount").toInt(0);
        if (stat == QStringLiteral("attack")) {
            m_state->itemBonusStrength += amount;
            for (Character *member : std::as_const(m_party))
                member->setItemBonuses(m_state->itemBonusStrength, m_state->itemBonusIntelligence);
        } else if (stat == QStringLiteral("intelligence")) {
            m_state->itemBonusIntelligence += amount;
            for (Character *member : std::as_const(m_party))
                member->setItemBonuses(m_state->itemBonusStrength, m_state->itemBonusIntelligence);
        } else if (stat == QStringLiteral("maxHp")) {
            m_state->itemBonusMaxHp += amount;
            for (Character *member : std::as_const(m_party)) {
                if (member->maxHp() > 0)
                    member->setMaxHp(member->maxHp() + amount);
            }
        }
        showInfoMessage(catalogEntry.value("name").toString(),
                         QStringLiteral("You feel a permanent change take hold."));
        if (consumeOnUse)
            scriptRemoveItem(itemId, 1);
    } else {
        m_scriptEngine.callEntryPoint(QStringLiteral("onItemUsed"), { QJSValue(itemId) });
    }
}

void GameScene::spawnItemInWorld(const QString &itemId, qreal worldX, qreal worldY)
{
    const QJsonObject entry = m_itemsCatalog.value(itemId).toObject();
    if (entry.isEmpty()) {
        qWarning() << "spawnItemInWorld: no item named" << itemId << "in the items catalog";
        return;
    }

    const qreal targetWidth = entry.value("width").toDouble();
    const QString imagePath = itemImagePath(entry);
    if (!QFileInfo::exists(imagePath)) {
        qWarning() << "Item visual missing for" << itemId << "at" << imagePath;
        return;
    }

    auto *prop = new Prop(imagePath, targetWidth);
    prop->setShadowOffset(m_shadowOffset);
    placeProp(prop, worldX, worldY, false); // items never block movement
    prop->setZValue(prop->zValue() + kItemZBoost); // see kItemZBoost's own comment

    m_worldItems.append(WorldItem{ prop, itemId, worldX, worldY });
}

void GameScene::dropRandomLoot(qreal worldX, qreal worldY)
{
    if (m_lootPool.isEmpty())
        return;
    if (QRandomGenerator::global()->generateDouble() >= kEnemyLootDropChance)
        return;

    const QString &itemId = m_lootPool.at(QRandomGenerator::global()->bounded(m_lootPool.size()));
    spawnItemInWorld(itemId, worldX, worldY);
    // Same spawn cue ScriptBridge plays for a scripted spawn - a loot drop
    // is engine-triggered, not script-triggered, but it's just as much a
    // "something appeared" moment worth signaling.
    m_audio.playSound(QStringLiteral("select"));
}

void GameScene::scriptGiveExperience(int amount)
{
    awardExperience(amount);
}

void GameScene::awardExperience(int amount)
{
    if (amount <= 0)
        return;

    m_state->experience += amount;
    bool leveledUp = false;
    while (m_state->experience >= xpRequiredForLevel(m_state->level)) {
        m_state->experience -= xpRequiredForLevel(m_state->level);
        m_state->level++;
        leveledUp = true;
    }

    // Applied/shown once even if this one award crossed several
    // thresholds at once, not once per level - several stacked "Level
    // Up!" captions would just look like a glitch, not a celebration.
    if (leveledUp) {
        applyLevelBonusesToParty();
        showLevelUpEffect();
    }
}

void GameScene::applyLevelBonusesToParty()
{
    const int strBonus = strengthBonusForLevel(m_state->level);
    const int intBonus = intelligenceBonusForLevel(m_state->level);
    const int spdBonus = speedBonusForLevel(m_state->level);
    for (Character *character : std::as_const(m_party)) {
        character->setLevelBonuses(strBonus, intBonus, spdBonus);
        character->heal(character->maxHp()); // full restore on level up - clamps at maxHp()
    }
}

void GameScene::showLevelUpEffect()
{
    Character *player = controlledCharacter();
    if (!player)
        return;
    new LevelUpTextItem(player, player->headTopY()); // self-removing (see its own header) - no pointer to keep
}

void GameScene::updateItemPickups()
{
    if (m_worldItems.isEmpty())
        return;

    Character *player = controlledCharacter();
    if (!player || player->isDead())
        return;

    const QPointF playerFeet = player->feetPos();

    for (int i = 0; i < m_worldItems.size(); ++i) {
        const WorldItem &item = m_worldItems.at(i);
        const QPointF delta = playerFeet - QPointF(item.worldX, item.worldY);
        if (std::hypot(delta.x(), delta.y()) > kItemPickupRadius)
            continue;

        const QString itemId = item.itemId;
        Prop *prop = item.prop;
        m_worldItems.removeAt(i);
        destroyEntity(prop);

        m_state->inventory[itemId] += 1;
        m_audio.playSound(QStringLiteral("select"));
        // Picking up a chapter's own key item counts as completing that
        // chapter's main task - automatic, no script involvement needed,
        // works for every chapter already written without touching them.
        if (m_itemsCatalog.value(itemId).toObject().value("keyItem").toBool(false))
            awardExperience(kKeyItemTaskExperience);
        m_scriptEngine.callEntryPoint(QStringLiteral("onItemCollected"), { QJSValue(itemId) });
        return; // one pickup per tick is plenty, and the vector just shifted
    }
}

void GameScene::scriptSetTileset(const QString &relativePath)
{
    QString error;
    if (!m_map.loadTileset(relativePath, &error)) {
        qWarning() << "script setTileset failed:" << error;
        return;
    }
    update(); // repaint - TileMapItem reads straight from m_map, no cached pixmap of its own
}

void GameScene::scriptSetTile(const QString &tileName, int tileCol, int tileRow)
{
    const int index = m_map.tileSheet().indexByName(tileName);
    if (index < 0) {
        qWarning() << "script setTile: no tile named" << tileName << "in the current tileset";
        return;
    }
    m_map.setBaseTile(tileCol, tileRow, index);
    update();
}

void GameScene::scriptSetBarrier(const QString &id, int tileCol, int tileRow, int tileWidth, int tileHeight, bool blocked)
{
    if (!blocked) {
        const QRectF rect = m_namedBarriers.take(id);
        if (!rect.isNull())
            m_blockingAreas.remove(rect);
        return;
    }

    const QRectF rect(tileCol * m_map.tileWidth(), tileRow * m_map.tileHeight(), tileWidth * m_map.tileWidth(),
                       tileHeight * m_map.tileHeight());
    if (m_namedBarriers.contains(id))
        return; // already up - a second setBarrier(..., true) with the same id is a no-op, not a duplicate
    m_namedBarriers.insert(id, rect);
    m_blockingAreas.insert(rect);
}

void GameScene::scriptGiveControl(const QString &name)
{
    Character *target = m_charactersByName.value(name);
    if (!target || target->isDead())
        return;
    const int index = m_party.indexOf(target);
    if (index < 0)
        return; // an enemy, not a controllable party member

    m_party.at(m_controlledIndex)->setVelocity(QPointF(0, 0));
    m_party.at(m_controlledIndex)->setRunning(false); // only the controlled character's run flag is ever refreshed - see MainWindow::refreshMoveIntent()
    m_controlledIndex = index;
    applyHealthBarDisplay();
}

QString GameScene::chapterVarKey(const QString &name) const
{
    return QFileInfo(m_mapPath).fileName() + QStringLiteral("::") + name;
}

void GameScene::scriptSetVar(const QString &name, const QVariant &value)
{
    m_state->vars[chapterVarKey(name)] = value;
}

QVariant GameScene::scriptGetVar(const QString &name, const QVariant &defaultValue) const
{
    return m_state->vars.value(chapterVarKey(name), defaultValue);
}

void GameScene::scriptSetGlobalVar(const QString &name, const QVariant &value)
{
    m_state->vars[name] = value;
}

QVariant GameScene::scriptGetGlobalVar(const QString &name, const QVariant &defaultValue) const
{
    return m_state->vars.value(name, defaultValue);
}

void GameScene::scriptGiveItem(const QString &itemId, int count)
{
    m_state->inventory[itemId] += count;
}

void GameScene::scriptRemoveItem(const QString &itemId, int count)
{
    const int remaining = m_state->inventory.value(itemId, 0) - count;
    if (remaining > 0)
        m_state->inventory[itemId] = remaining;
    else
        m_state->inventory.remove(itemId);
}

int GameScene::scriptGetItemCount(const QString &itemId) const
{
    return m_state->inventory.value(itemId, 0);
}

bool GameScene::scriptHasItem(const QString &itemId) const
{
    return scriptGetItemCount(itemId) > 0;
}

void GameScene::scriptLoadLevel(const QString &relativePath)
{
    const QString resolvedPath = QFileInfo(m_mapPath).dir().filePath(relativePath);
    emit levelChangeRequested(resolvedPath);
}

void GameScene::scriptPlaySound(const QString &name)
{
    m_audio.playSound(name);
}

void GameScene::scriptPlayMusic(const QString &name, bool loop)
{
    m_audio.playMusic(name, loop);
}

void GameScene::scriptStopMusic()
{
    m_audio.stopMusic();
}

GameScene::SelectionInfo GameScene::selectionInfoForCharacter(Character *character) const
{
    SelectionInfo info;
    info.portrait = character->portraitPixmap();
    info.name = prettifyRosterName(character->name());
    // maxHp() <= 0 means "never given combat stats" (a plain NPC never
    // spawned with hp>0 - see createCharacterAt()) - no health bar, no HP
    // line here either. hasLevel is party-only: enemies/NPCs have no
    // per-character level concept at all, only the party's own shared
    // GameState::level (see scriptGiveExperience()) actually applies.
    info.hasHp = character->maxHp() > 0;
    info.hp = character->hp();
    info.maxHp = character->maxHp();
    info.hasLevel = m_party.contains(character);
    info.level = m_state->level;
    return info;
}

GameScene::SelectionInfo GameScene::selectionInfoForItem(const WorldItem &item) const
{
    const QJsonObject entry = m_itemsCatalog.value(item.itemId).toObject();
    SelectionInfo info;
    info.portrait = QPixmap(itemImagePath(entry));
    info.name = entry.value("name").toString();
    info.description = entry.value("description").toString();
    return info;
}

void GameScene::trySelect(QGraphicsItem *target, const SelectionInfo &info, int partyIndex)
{
    if (m_selectedItem == target) {
        deselectCurrent();
        return;
    }

    m_selectedItem = target;
    m_selectedIndex = partyIndex;
    m_audio.playSound(QStringLiteral("select"));

    // Parented to the target itself rather than tracked separately, so it
    // rides along automatically as the target moves/is re-parented through
    // ticks - no per-frame bookkeeping needed here. Works the same way for
    // a Character or an item's Prop, since both are QGraphicsItems.
    if (!m_selectionMarker) {
        m_selectionMarker = new QGraphicsRectItem();
        QPen pen(Qt::yellow);
        pen.setWidth(3);
        pen.setCosmetic(true); // stays 3px on screen regardless of any view scaling
        m_selectionMarker->setPen(pen);
        m_selectionMarker->setBrush(Qt::NoBrush);
        m_selectionMarker->setZValue(1);
    }
    m_selectionMarker->setRect(target->boundingRect().adjusted(-4, -4, 4, 4));
    m_selectionMarker->setParentItem(target);
    m_selectionMarker->show();

    emit selectionChanged(info);
}

void GameScene::deselectCurrent()
{
    if (!m_selectedItem)
        return;
    m_selectedItem = nullptr;
    m_selectedIndex = -1;
    if (m_selectionMarker)
        m_selectionMarker->hide();
    emit selectionCleared();
}

void GameScene::beforeEntityDestroyed(QGraphicsItem *entity)
{
    // Deselecting only hides the marker: it is still a child of the old
    // target, even though m_selectedItem is already null. Qt deletes that
    // child with its parent, so invalidate it independently of selection.
    if (m_selectionMarker && m_selectionMarker->parentItem() == entity)
        m_selectionMarker = nullptr;

    if (auto *character = dynamic_cast<Character *>(entity)) {
        // Repeated enemy archetypes share a name; preserve a newer live
        // instance that may have replaced this one's lookup.
        if (m_charactersByName.value(character->name()) == character)
            m_charactersByName.remove(character->name());
        m_partyAttackCooldowns.remove(character);
        m_fireballCooldowns.remove(character);
        m_partyPaths.remove(character);
        if (m_trailLeader == character) {
            m_trailLeader = nullptr;
            m_leaderTrail.clear();
        }
        for (int i = m_pendingFireballHits.size() - 1; i >= 0; --i) {
            if (m_pendingFireballHits.at(i).target == character)
                m_pendingFireballHits.removeAt(i);
        }
    }

    if (m_selectedItem == entity) {
        m_selectedItem = nullptr;
        m_selectedIndex = -1;
        emit selectionCleared();
    }
}

void GameScene::destroyEntity(QGraphicsItem *entity)
{
    beforeEntityDestroyed(entity);
    removeItem(entity);
    delete entity;
}

void GameScene::mousePressEvent(QGraphicsSceneMouseEvent *event)
{
    if (event->button() == Qt::LeftButton) {
        // items() returns topmost-first, so this picks whichever thing is
        // actually drawn on top at the click point, not just the first
        // match in list order - the showcase grid overlaps heavily.
        const QList<QGraphicsItem *> hits = items(event->scenePos());
        for (QGraphicsItem *item : hits) {
            if (auto *character = dynamic_cast<Character *>(item)) {
                const int partyIndex = m_party.indexOf(character);
                const bool isEnemy = std::any_of(m_enemies.cbegin(), m_enemies.cend(),
                                                  [character](const Enemy &e) { return e.character == character; });
                const bool isNpc = std::any_of(m_npcs.cbegin(), m_npcs.cend(),
                                                [character](const Npc &n) { return n.character == character; });
                if (partyIndex >= 0 || isEnemy || isNpc) {
                    trySelect(character, selectionInfoForCharacter(character), partyIndex);
                    event->accept();
                    return;
                }
            } else if (auto *prop = dynamic_cast<Prop *>(item)) {
                // Only a world-item pickup is selectable here - a
                // decorative/blocking prop (tracked in m_props, not
                // m_worldItems) explicitly isn't, per the "props don't
                // enter in this context" request. Falls through to the
                // deselectCurrent() below, same as clicking bare ground.
                for (const WorldItem &worldItem : std::as_const(m_worldItems)) {
                    if (worldItem.prop == prop) {
                        trySelect(prop, selectionInfoForItem(worldItem), -1);
                        event->accept();
                        return;
                    }
                }
            }
        }
        deselectCurrent();
        event->accept();
        return;
    }
    QGraphicsScene::mousePressEvent(event);
}

void GameScene::onTick()
{
    const qint64 nowMs = m_clock.elapsed();
    const qreal dt = std::min((nowMs - m_lastElapsedMs) / 1000.0, kMaxTickDtSeconds);
    m_lastElapsedMs = nowMs;

    // Driven from here rather than each item's own independent QTimer -
    // see TileMapItem::tick()/LightingOverlayItem::tick().
    if (m_tileMapItem)
        m_tileMapItem->tick();
    if (m_lightingOverlayItem)
        m_lightingOverlayItem->tick();

    // See m_temporarilyBlockedCells - each entry expires on its own after
    // kTemporaryBlockSeconds rather than staying blacklisted forever.
    for (auto it = m_temporarilyBlockedCells.begin(); it != m_temporarilyBlockedCells.end();) {
        it.value() -= dt;
        if (it.value() <= 0.0)
            it = m_temporarilyBlockedCells.erase(it);
        else
            ++it;
    }

    // See togglePosePreview() - advances the forced pose loop on its own
    // timer, independent of whatever combat/movement would otherwise be
    // driving the controlled character's animation this tick.
    if (m_posePreviewActive) {
        m_posePreviewElapsed += dt;
        if (m_posePreviewElapsed >= kPosePreviewSecondsPerRow) {
            m_posePreviewElapsed -= kPosePreviewSecondsPerRow;
            m_posePreviewRowIndex = (m_posePreviewRowIndex + 1) % kPosePreviewRows.size();
            if (Character *character = controlledCharacter())
                character->playPreviewAction(kPosePreviewRows.at(m_posePreviewRowIndex));
        }
    }

    m_scriptEngine.onTick(dt);
    updateEnemyAI(dt);
    updatePartyAI(dt);
    // After both melee AI passes, so a character that already started a
    // melee swing this tick (isActing()) never also casts the same tick -
    // melee gets first refusal.
    updateFireballCasting(dt);
    updatePendingFireballHits(dt);
    updateCorpseCleanup(dt);
    updateItemPickups();

    for (Character *character : std::as_const(m_party)) {
        character->tick(dt);
        if (character->consumeWhistlePending())
            playCreatureSound(character->name(), QStringLiteral("whistle"));
    }
    for (const Enemy &enemy : std::as_const(m_enemies)) {
        enemy.character->tick(dt);
        if (enemy.character->consumeWhistlePending())
            playCreatureSound(enemy.name, QStringLiteral("whistle"));
    }
    for (const Npc &npc : std::as_const(m_npcs)) {
        npc.character->tick(dt);
        if (npc.character->consumeWhistlePending())
            playCreatureSound(npc.name, QStringLiteral("whistle"));
    }

    // feetPos(), not pos() + boundingRect().center() - the latter is the
    // sprite's full (now heavily padded, see tools/refit_sprites.py) frame
    // center, which sits well away from the character's actual visible
    // position and would center the camera off from where the player
    // reads as actually standing.
    if (Character *controlled = controlledCharacter())
        emit controlledCharacterMoved(controlled->feetPos());
}
