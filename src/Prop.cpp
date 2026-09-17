#include "Prop.h"

#include <QHash>
#include <QImage>
#include <QPainter>
#include <QPixmap>
#include <QRadialGradient>
#include <algorithm>

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
struct PropAsset {
    QPixmap pixmap;
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
        asset.feetFraction = measureFeetFraction(pixmap);
        asset.pixmap = std::move(pixmap);
        it = cache.insert(cacheKey, asset);
    }
    // QPixmap is implicitly shared (copy-on-write) - this copies a handle,
    // not the pixel data, so every Prop instance sharing a cache entry
    // still costs only a few bytes on top of the one real decode+scale.
    setPixmap(it.value().pixmap);
    m_feetFraction = it.value().feetFraction;
}

void Prop::paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget)
{
    // Same technique as Character::paint()'s shadow - see its comment for
    // why this is one cheap gradient fill, not per-pixel image work. Sized
    // a little smaller relative to width than Character's (0.22 vs 0.28) -
    // most props are wider relative to their own "footprint" than a
    // character sprite is, so the same fraction would read as oversized.
    const QPointF anchor = groundAnchorOffset();
    // Capped, not just scaled - the widest props (the horizon-art
    // backdrops placed along a map's edges) would otherwise get a shadow
    // blob completely out of scale with the rest of the scene. The cap is
    // doubled along with the 2x asset scale (see tools/upscale_2x.py,
    // which doubled every catalog "width") - boundingRect().width() auto-
    // scales with that, but a stale cap would clamp nearly every normal
    // prop's shadow down to its old, now-way-too-small pixel size.
    const qreal shadowRadius = std::min(boundingRect().width() * 0.22, 60.0);
    constexpr qreal kShadowSquash = 0.4;

    QRadialGradient gradient(QPointF(0, 0), shadowRadius);
    gradient.setColorAt(0.0, QColor(0, 0, 0, 90));
    gradient.setColorAt(0.7, QColor(0, 0, 0, 48));
    gradient.setColorAt(1.0, QColor(0, 0, 0, 0));

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->translate(anchor + m_shadowOffset);
    painter->scale(1.0, kShadowSquash);
    painter->setPen(Qt::NoPen);
    painter->setBrush(gradient);
    painter->drawEllipse(QPointF(0, 0), shadowRadius, shadowRadius);
    painter->restore();

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
