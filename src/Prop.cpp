#include "Prop.h"

#include <QHash>
#include <QImage>
#include <QPainter>
#include <QPixmap>
#include <QRadialGradient>
#include <algorithm>
#include <cmath>

namespace {
// Loading a PNG from disk and running it through a Qt::SmoothTransformation
// scale is genuinely expensive - fine for the handful of props a small map
// used to have, but a real bottleneck once a single map's maze/scatter
// generation calls this constructor a few thousand times for what's often
// the exact same (imagePath, targetWidth) pair (e.g. "boulder_large" used
// as one of 5-6 cycled maze-wall obstacles, appearing hundreds of times
// per chapter). Process-lifetime cache, not per-scene - the same prop art
// looks identical in every chapter that uses it, so there's no reason to
// pay this cost again on the next level transition either.
//
// The pixmap held here is TRIMMED to the bounding box of its visible
// (alpha > 0) pixels, with `offset` saying where that box sits in the full
// scaled art and `fullSize` the full size. About 40% of a typical prop's
// canvas is empty margin, and the software rasterizer walks every pixel of
// a pixmap it blends - with hundreds of props in view (a border row, a
// dense maze) that empty area was a large share of the frame. Drawing the
// trimmed pixmap at its offset is pixel-identical: the skipped pixels are
// fully transparent, so they contribute nothing.
struct PropAsset {
    QPixmap pixmap;
    QPoint offset;
    QSizeF fullSize;
    qreal feetFraction = 0.95;
};

QHash<QString, PropAsset> &propAssetCache()
{
    static QHash<QString, PropAsset> cache;
    return cache;
}

// The prop-art equivalent of SpriteSheet::feetFraction() - where an image's
// own opaque content actually ends, as a fraction of its full height.
// Characters can get away with one hardcoded constant because every sheet
// comes through the same refit_sprites.py pipeline with the same margin;
// prop art has no such pipeline; each PNG was generated independently and
// carries whatever padding it happens to carry. A wall or archway asset is
// often opaque clear to its canvas edge (fraction 1.0), while a smaller
// decorative or item asset (a berry pouch, a bush) can leave a real gap
// below its own silhouette. Assuming a single fixed fraction for all of
// them either buries the anchor inside solid art (shadow drawn over the
// object) or strands it out in the empty margin below it (shadow rendered
// far past the visible sprite - the "floating prop" look, or, for enough
// padding, a shadow invisible because it never overlaps anything but bare
// ground). Measuring each asset's real bottom once at load time (cached
// alongside its pixmap, so this scan also only ever runs once per unique
// asset) fixes both directions at once.
qreal measureFeetFraction(const QPixmap &pixmap)
{
    if (pixmap.isNull() || pixmap.height() <= 0)
        return 0.95;
    const QImage img = pixmap.toImage().convertToFormat(QImage::Format_ARGB32);
    for (int y = img.height() - 1; y >= 0; --y) {
        const QRgb *line = reinterpret_cast<const QRgb *>(img.constScanLine(y));
        for (int x = 0; x < img.width(); ++x) {
            if (qAlpha(line[x]) > 10)
                return qreal(y + 1) / img.height();
        }
    }
    return 0.95; // fully transparent image (shouldn't happen) - keep the old guess
}

// The soft ground shadow (see Prop::paint()) is the same picture for every
// prop with the same radius - a black radial gradient squashed into a flat
// ellipse - yet it used to be re-rasterized per prop, per frame (an
// antialiased gradient fill plus a painter save/restore), which at a few
// hundred props in view was a large share of the frame. Rendered once per
// distinct radius (quantized to 1/8 px, far below anything visible) into a
// small pixmap and drawn from there. Same technique and constants as before.
constexpr qreal kShadowSquash = 0.4;

const QPixmap &shadowPixmapFor(qreal radius)
{
    static QHash<int, QPixmap> cache;
    const int key = qRound(radius * 8.0);
    auto it = cache.find(key);
    if (it == cache.end()) {
        const qreal r = key / 8.0;
        const int w = static_cast<int>(std::ceil(r * 2.0)) + 2;
        const int h = static_cast<int>(std::ceil(r * 2.0 * kShadowSquash)) + 2;
        QRadialGradient gradient(QPointF(0, 0), r);
        gradient.setColorAt(0.0, QColor(0, 0, 0, 90));
        gradient.setColorAt(0.7, QColor(0, 0, 0, 48));
        gradient.setColorAt(1.0, QColor(0, 0, 0, 0));
        QImage image(w, h, QImage::Format_ARGB32_Premultiplied);
        image.fill(Qt::transparent);
        QPainter p(&image);
        p.setRenderHint(QPainter::Antialiasing, true);
        p.translate(w / 2.0, h / 2.0);
        p.scale(1.0, kShadowSquash);
        p.setPen(Qt::NoPen);
        p.setBrush(gradient);
        p.drawEllipse(QPointF(0, 0), r, r);
        p.end();
        it = cache.insert(key, QPixmap::fromImage(image));
    }
    return it.value();
}

// The tightest crop of `full` that keeps every pixel with any alpha. Leaves
// `full` alone (offset 0,0) if it is already tight or has no visible pixel.
QPixmap trimToContent(const QPixmap &full, QPoint *offset)
{
    *offset = QPoint(0, 0);
    if (full.isNull())
        return full;
    const QImage img = full.toImage().convertToFormat(QImage::Format_ARGB32);
    int minX = img.width(), minY = img.height(), maxX = -1, maxY = -1;
    for (int y = 0; y < img.height(); ++y) {
        const QRgb *line = reinterpret_cast<const QRgb *>(img.constScanLine(y));
        for (int x = 0; x < img.width(); ++x) {
            if (qAlpha(line[x]) == 0)
                continue;
            minX = std::min(minX, x);
            maxX = std::max(maxX, x);
            minY = std::min(minY, y);
            maxY = std::max(maxY, y);
        }
    }
    if (maxX < minX || maxY < minY)
        return full;
    const QRect bounds(minX, minY, maxX - minX + 1, maxY - minY + 1);
    if (bounds == img.rect())
        return full;
    *offset = bounds.topLeft();
    return full.copy(bounds);
}
}

Prop::Prop(const QString &imagePath, qreal targetWidth, QGraphicsItem *parent)
    : QGraphicsPixmapItem(parent)
{
    const QString cacheKey = imagePath + QLatin1Char('@') + QString::number(targetWidth);
    auto &cache = propAssetCache();
    auto it = cache.find(cacheKey);
    if (it == cache.end()) {
        QPixmap pixmap(imagePath);
        if (targetWidth > 0 && pixmap.width() > 0) {
            const qreal scale = targetWidth / pixmap.width();
            pixmap = pixmap.scaled(pixmap.size() * scale, Qt::KeepAspectRatio, Qt::SmoothTransformation);
        }
        PropAsset asset;
        asset.feetFraction = measureFeetFraction(pixmap); // on the FULL art - a fraction of its full height
        asset.fullSize = QSizeF(pixmap.width(), pixmap.height());
        asset.pixmap = trimToContent(pixmap, &asset.offset);
        it = cache.insert(cacheKey, asset);
    }
    // QPixmap is implicitly shared (copy-on-write) - this copies a handle,
    // not the pixel data, so every Prop instance sharing a cache entry
    // still costs only a few bytes on top of the one real decode+scale.
    setPixmap(it.value().pixmap);
    setOffset(it.value().offset);
    m_fullSize = it.value().fullSize;
    m_feetFraction = it.value().feetFraction;
}

QRectF Prop::boundingRect() const
{
    return QRectF(QPointF(0, 0), m_fullSize);
}

void Prop::paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget)
{
    // Same look as Character::paint()'s shadow (a soft flat ellipse), but
    // drawn from a cached pixmap - see shadowPixmapFor() above for why not
    // a gradient fill per prop per frame. Sized a little smaller relative
    // to width than Character's (0.22 vs 0.28) - most props are wider
    // relative to their own "footprint" than a character sprite is, so the
    // same fraction would read as oversized.
    const QPointF anchor = groundAnchorOffset();
    // Capped, not just scaled - the widest props (the horizon-art
    // backdrops placed along a map's edges) would otherwise get a shadow
    // blob completely out of scale with the rest of the scene. The cap is
    // doubled along with the 2x asset scale (see tools/upscale_2x.py,
    // which doubled every catalog "width") - boundingRect().width() auto-
    // scales with that, but a stale cap would clamp nearly every normal
    // prop's shadow down to its old, now-way-too-small pixel size.
    const qreal shadowRadius = std::min(boundingRect().width() * 0.22, 60.0);

    const QPixmap &shadow = shadowPixmapFor(shadowRadius);
    const QPointF shadowCenter = anchor + m_shadowOffset;
    painter->drawPixmap(QPointF(shadowCenter.x() - shadow.width() / 2.0, shadowCenter.y() - shadow.height() / 2.0), shadow);

    QGraphicsPixmapItem::paint(painter, option, widget);
}

QPointF Prop::groundAnchorOffset() const
{
    // Bottom-center at this specific asset's own measured content bottom -
    // same convention as Character::feetOffset(), so a prop "stands" on the
    // point it's placed at rather than having that point sit at a guessed
    // fraction of its canvas that may fall inside solid art or out past its
    // real silhouette in empty padding. See measureFeetFraction() above.
    const QRectF r = boundingRect();
    return QPointF(r.width() / 2.0, r.height() * m_feetFraction);
}

QRectF Prop::footprintRect() const
{
    const QRectF r = boundingRect();
    const qreal width = r.width() * 0.5;
    const qreal height = r.height() * 0.18;
    const qreal top = r.height() * m_feetFraction - height; // just above the ground anchor point
    return QRectF(r.center().x() - width / 2.0, top, width, height);
}
