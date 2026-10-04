#pragma once

#include <QString>

// Where the game's read-only data (the assets/ tree) lives at runtime.
// Resolved once, in this order:
//   1. $T2GU_ASSET_DIR, if it names an existing directory (an explicit
//      override, handy for testing an install or a relocated tree).
//   2. The configured GNUInstallDirs data path, if it exists. With relative
//      bindir/datadir this is relative to the executable (../share/t2gu2/assets
//      by default), so moving the whole prefix preserves discovery. Explicitly
//      absolute install directories retain their fixed configured data path.
//   3. ASSET_DIR, the source tree's assets/ directory that CMake bakes in at
//      compile time - what a binary run straight out of the build directory
//      uses, exactly as before installing was possible.
QString assetDir();

// assetDir() + relativePath, e.g. assetPath("/maps/chapter1.json").
// relativePath starts with a '/'.
QString assetPath(const QString &relativePath);
