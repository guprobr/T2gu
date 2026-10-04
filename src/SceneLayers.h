#pragma once

#include <QtGlobal>

// Ordinary scenery/characters use ground Y (at most 4096 * 4096 pixels
// for a validated map). Keep separate top-level bands above that range;
// a child's z-value only sorts within its parent's stacking group.
namespace SceneLayers {
inline constexpr qreal Pickups = 1'000'000'000.0; // add ground Y within this band
inline constexpr qreal Projectiles = 2'000'000'000.0;
inline constexpr qreal Lighting = 3'000'000'000.0;
inline constexpr qreal Notifications = 4'000'000'000.0;
}
