#pragma once

#include <QHash>
#include <QPixmap>
#include <QPoint>
#include <QSize>
#include <QString>

#include <memory>

// Loads a per-character sprite sheet laid out as a grid: each row is one
// action (names and count vary per character - not every character has
// the same action set), and each row is split into two blocks of frames
// side-by-side - a Front block (facing the camera) followed by a Back
// block (facing away), separated by a fixed number of blank gutter
// columns. Left/right facing has no dedicated art; it's approximated by
// horizontally mirroring whichever block is playing. Layout is described
// by a JSON sidecar file next to the PNG, so adding/reordering actions
// never touches C++ code.
//
// The sheet reserves a fixed number of front/back columns (the grid
// geometry, shared by every row so the back block always starts at the
// same x regardless of row), but not every row's animation uses all of
// its reserved columns - e.g. a 4-column grid where IDLE only has 3 real
// frames and the 4th column is left blank. Per-row framesFront/framesBack
// overrides say how many of the reserved columns that row actually
// animates through; a row without an override uses the sheet-level count.
//
// The grid pitch (frameWidth/frameHeight) is a plain, exact cell size -
// every frame's real content already sits cleanly within its own cell, so
// frame() is a direct crop. This used to not be true: some poses (a raised
// weapon, a head turned to the side) were drawn larger than their own
// cell in the original art, clipping the pose at its cell boundary and
// bleeding a fragment into the neighbor. Rather than re-editing every
// affected frame by hand, that used to be corrected at runtime - crop each
// cell with extra reach into its neighbors, then run the assembled image
// through a connected-component pass to tell "this frame's own content"
// apart from bled-in fragments (see tools/realign_sprites.py's own header
// comment for the exact algorithm, and this file's git history for the
// runtime version it replaced). That correction has since been baked into
// the source art once, offline, by that script, across the whole character
// roster - every sheet's frameWidth/frameHeight already reflects the
// corrected, no-bleed cell size, so there's nothing left for frame() to
// work around at runtime.
//
// Memory: a sheet is a big, mostly empty image (a typical character's is
// 4480x10120 RGBA, ~181 MB decoded, and each cell is margin-padded around
// content that fills a small part of it). load() decodes it once, keeps
// only every frame's non-transparent bounding box (roughly a tenth of the
// size), and drops the sheet - holding every character's whole sheet
// resident is what made the sandbox roster use ~20 GB. The trimmed frames
// live behind a shared_ptr, so copying a SpriteSheet (every Character
// gets one) shares them rather than duplicating them.
class SpriteSheet
{
public:
    enum class Facing { Front, Back };

    // One frame, trimmed to its non-transparent bounding box. `offset` is
    // where the trimmed pixmap's top-left sits within the frame's full
    // cellSize() cell, so painting it there is pixel-identical to painting
    // the whole padded cell. A frame with no visible pixels has a null
    // pixmap.
    struct Frame
    {
        QPixmap pixmap;
        QPoint offset;
    };

    bool load(const QString &jsonPath, QString *errorOut = nullptr);

    bool hasMovement(const QString &name) const { return m_rows.contains(name); }
    // `mirrored` flips the frame horizontally within its cell (left-facing
    // art is the right-facing block mirrored); mirrored frames are built on
    // first use and cached.
    Frame frame(const QString &movement, int frameIndex, Facing facing, bool mirrored = false) const;
    // The same frame as one full-cell pixmap, composed on demand and NOT
    // cached (~2 MB) - for one-off uses like a UI portrait, not per-tick
    // drawing.
    QPixmap paddedFrame(const QString &movement, int frameIndex, Facing facing) const;
    // The full grid cell every Frame::offset is relative to.
    QSize cellSize() const;
    int frameCount(const QString &movement, Facing facing) const;
    int frameDurationMs() const { return m_frameDurationMs; }

    // Fraction of frame()'s returned pixmap height where the character's
    // feet/ground-contact point sits - a fixed nominal fraction of the cell.
    qreal feetFraction() const;

    // Fraction of frame()'s returned pixmap height where the character's
    // own visible content actually starts (its head, roughly) - needed
    // because tools/refit_sprites.py bottom-anchors each character's
    // content within its cell with real empty margin above it (see that
    // script's own comment), so "the top of the frame" is no longer a
    // reasonable stand-in for "the top of the character" the way it used
    // to be when cells were tightly cropped.
    qreal topFraction() const;

private:
    struct Row
    {
        int index = 0;
        int framesFront = -1; // -1 = no override, use the sheet-level count
        int framesBack = -1;
    };

    struct Storage
    {
        QHash<qint64, Frame> frames;   // trimmed, keyed by (row.index, col) - see load()
        QHash<qint64, Frame> mirrored; // built lazily by frame(); the app only touches sheets from the GUI thread
    };

    static qint64 frameKey(int rowIndex, int col) { return (static_cast<qint64>(rowIndex) << 32) | static_cast<quint32>(col); }
    // How many of a row's reserved columns its animation actually uses in a
    // facing block - the per-row override if it has one, else the sheet-level count.
    int rowFrameCount(const Row &row, Facing facing) const;
    // Grid column where a facing's block starts - after the sheet's
    // reserved Front columns plus the blank gutter, a fixed offset shared
    // by every row even if a particular row doesn't animate through all of
    // its Front slots.
    int facingOffset(Facing facing) const;

    std::shared_ptr<Storage> m_storage = std::make_shared<Storage>();
    int m_frameWidth = 0;
    double m_frameHeight = 0.0;
    int m_framesFront = 4;  // reserved front columns in the grid (also the default per-row count)
    int m_framesBack = 4;   // reserved back columns in the grid (also the default per-row count)
    int m_gutterSlots = 0;  // blank columns between the front and back blocks
    int m_frameDurationMs = 120;
    QHash<QString, Row> m_rows;
};
