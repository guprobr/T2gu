#pragma once

#include <QGraphicsItem>
#include <QGraphicsScene>
#include <QGraphicsView>
#include <QRectF>

// Returns the portion of `item`'s own local coordinate space that's
// actually visible in its scene's view right now.
//
// Use this instead of a bare update() on any item whose boundingRect()
// covers far more than one screen (e.g. a whole map) but whose paint()
// only needs to redraw what's actually on screen (already true of both
// current callers, TileMapItem and LightingOverlayItem - see their own
// paint()/exposedRect handling). update() with no argument marks the
// item's WHOLE boundingRect dirty, forcing Qt to reconsider every other
// item underneath it too - fine for a small item, but a real, measured
// cost for a map-sized one driven by a periodic animation timer, and one
// that gets *worse* as the map grows, not better. That's exactly backwards
// for an approach meant to scale - hence this helper existing at all,
// rather than leaving each such item to duplicate (or subtly get wrong)
// the same fix on its own.
//
// Assumes `item` has no rotation/shear and shares its scene's coordinate
// space directly (no non-identity item-level transform of its own) - true
// for both current callers, each placed at the scene origin with no
// transform; only the QGraphicsView itself scales. Falls back to the
// item's full boundingRect() if it has no scene or no view yet (e.g. a
// timer firing before the item's been added to one).
inline QRectF visibleSceneRectFor(const QGraphicsItem *item)
{
    if (const QGraphicsScene *scene = item->scene()) {
        const QList<QGraphicsView *> views = scene->views();
        if (!views.isEmpty()) {
            const QGraphicsView *view = views.first();
            return view->mapToScene(view->viewport()->rect()).boundingRect();
        }
    }
    return item->boundingRect();
}
