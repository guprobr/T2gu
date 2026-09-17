#pragma once

#include <QHash>
#include <QString>
#include <QVariant>

// Story/quest state that must survive a level transition (see
// MainWindow::loadLevel, which destroys the old GameScene and constructs a
// new one for the target map) - everything else about a GameScene (party,
// enemies, NPCs, the map itself) is tied to that one scene/map and is not
// meant to carry over; a new chapter's own onLevelStart is responsible for
// re-spawning whatever it wants present (the hero, any companions revealed
// so far, etc).
//
// Owned by MainWindow, outlives any individual GameScene. Passed into each
// GameScene's constructor as a non-owning pointer.
struct GameState
{
    QHash<QString, QVariant> vars;    // api.setVar/getVar
    QHash<QString, int> inventory;    // api.giveItem/removeItem/getItemCount
    QString lastMusicTrack;           // see GameScene's constructor - avoids repeating the same level's music back to back

    // The party's shared level/XP - see GameScene::awardExperience(). Level
    // 1 means "no bonus yet"; every level past that adds to the whole
    // party's Strength/Intelligence/Speed (see
    // GameScene::applyLevelBonusesToParty()), not just whoever's currently
    // controlled.
    int level = 1;
    int experience = 0;

    // Permanent stat increases granted by consumable items (see GameScene::
    // useItem()'s "permanentBoost" effect type) - unlike the level bonuses
    // above (a pure function of `level`, recomputed from scratch on every
    // level-up), these accumulate one item at a time and can't be
    // rederived, so they're persisted here directly and applied to every
    // party member (including one who hasn't joined yet - see
    // GameScene::scriptSpawnCharacter()) the same way level bonuses are.
    int itemBonusStrength = 0;
    int itemBonusIntelligence = 0;
    int itemBonusMaxHp = 0;

    // The hero's own base max HP, BEFORE itemBonusMaxHp - 200 for a brand
    // new game. Every chapter script's own `api.spawnCharacter("lara_cyber",
    // col, row)` call deliberately omits the hp argument specifically so
    // this is the single source of truth for it (see GameScene::
    // scriptSpawnCharacter() - hp<=0 from a script means "use this"), never
    // a literal hardcoded per chapter. That matters because a hardcoded
    // per-chapter literal would silently reset the hero back to it on every
    // level transition, wiping out any future "max HP grows with level" (or
    // similar) mechanic the moment this field started being written to
    // instead of just read - this way, a chapter transition always carries
    // forward whatever the hero's current base actually is, exactly like
    // level/experience/itemBonusMaxHp already do.
    int heroBaseMaxHp = 200;
};
