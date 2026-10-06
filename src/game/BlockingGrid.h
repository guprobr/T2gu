#pragma once

#include <QHash>
#include <QRectF>
#include <QVector>
#include <algorithm>
#include <cmath>

// A spatial hash over blocking rectangles, bucketed by a fixed-size grid.
// Character::isBlocked() is called several times per moving character per
// tick - a flat linear scan over every blocking rect (a plain QVector, the
// original design) was fine when a map had a "handful" of props, but once
// the whole-map maze remodels pushed per-chapter prop counts into the
// thousands, that scan became the dominant per-frame cost: every active
// (moving/chasing) character paid an O(all props) scan on every movement
// step, and the cost compounded as more enemies became active chasers
// deeper into a level - exactly the "stutters after a while, worse with
// more elements" symptom this was built to fix.
//
// Buckets are sized comfortably larger than any prop's footprint (the
// widest, `cliff_face`, has an ~85px footprint half-width) - insertion
// registers a rect in every bucket its bounding box overlaps, which is
// what makes a point query safe to check only the single bucket
// containing that point: if a rect contains the query point, the point's
// own bucket is necessarily one the rect was inserted into, since the
// rect's bounding box overlaps wherever the point sits.
class BlockingGrid
{
public:
    quint64 revision() const { return m_revision; }
    void clear()
    {
        m_buckets.clear();
        ++m_revision;
    }

    void insert(const QRectF &rect)
    {
        forEachBucket(rect, [this, &rect](qint64 key) { m_buckets[key].append(rect); });
        ++m_revision;
    }

    void remove(const QRectF &rect)
    {
        forEachBucket(rect, [this, &rect](qint64 key) {
            auto it = m_buckets.find(key);
            if (it != m_buckets.end())
                it->removeOne(rect);
        });
        ++m_revision;
    }

    bool containsPoint(qreal x, qreal y) const
    {
        const auto it = m_buckets.constFind(bucketKey(bucketIndex(x), bucketIndex(y)));
        if (it == m_buckets.constEnd())
            return false;
        for (const QRectF &rect : it.value()) {
            if (rect.contains(x, y))
                return true;
        }
        return false;
    }

    // The movement integrator resolves one axis at a time. Scan only the
    // buckets along that segment and intersect rectangles continuously,
    // so even a subpixel footprint cannot be jumped over at high speed.
    bool blocksAxisMove(QPointF from, QPointF to) const
    {
        Q_ASSERT(from.x() == to.x() || from.y() == to.y());
        const QRectF span(from, to);
        bool blocked = false;
        forEachBucket(span.normalized(), [&](qint64 key) {
            if (blocked)
                return;
            const auto it = m_buckets.constFind(key);
            if (it == m_buckets.constEnd())
                return;
            for (const QRectF &rect : it.value()) {
                // Match endpoint collision when a barrier has just been
                // placed around the start: stepping out remains possible.
                if (rect.isEmpty() || (rect.contains(from) && !rect.contains(to)))
                    continue;
                if (std::max(from.x(), to.x()) >= rect.left()
                        && std::min(from.x(), to.x()) <= rect.right()
                        && std::max(from.y(), to.y()) >= rect.top()
                        && std::min(from.y(), to.y()) <= rect.bottom()) {
                    blocked = true;
                    break;
                }
            }
        });
        return blocked;
    }

private:
    // Doubled along with the 2x asset scale (see tools/upscale_2x.py) to
    // keep the same typical-content-to-bucket-size ratio this session
    // measured a 513x collision-check speedup from - world-pixel distances
    // (and therefore typical footprint-rect sizes) doubled, so a stale
    // bucket size would pack roughly 4x as many rects into each bucket.
    static constexpr qreal kBucketSize = 256.0;
    static int bucketIndex(qreal v) { return static_cast<int>(std::floor(v / kBucketSize)); }
    static qint64 bucketKey(int bx, int by) { return (static_cast<qint64>(bx) << 32) ^ static_cast<quint32>(by); }

    template <typename Fn>
    static void forEachBucket(const QRectF &rect, Fn &&fn)
    {
        const int x0 = bucketIndex(rect.left()), x1 = bucketIndex(rect.right());
        const int y0 = bucketIndex(rect.top()), y1 = bucketIndex(rect.bottom());
        for (int bx = x0; bx <= x1; bx++)
            for (int by = y0; by <= y1; by++)
                fn(bucketKey(bx, by));
    }

    QHash<qint64, QVector<QRectF>> m_buckets;
    quint64 m_revision = 0; // invalidates cached navigation after any blocker change
};
