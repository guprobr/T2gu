#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QObject>
#include <QString>

// A single translucent, full-map overlay that tints the whole scene to
// suggest ambient light - a warm sunrise/sunset gradient, flickering
// torchlight, a cool cavern vignette, or a slow shifting mystical glow.
// GameScene adds at most one of these per map (see kLightingOverlayZValue
// in GameScene.cpp), at a Z value far above every prop/character (which are
// Z-sorted by world Y, so always well under it), so it paints last and
// tints everything already drawn beneath it - unlike TileMapItem's water
// ripple, which only ever needed to affect the water tile itself.
//
// This is deliberately NOT per-pixel QImage manipulation - a translucent
// QLinearGradient/QRadialGradient fill already *is* per-pixel color+alpha
// blending, done by the rasterizer in one call, which is the difference
// between "cheap ambient wash" (this) and an actual per-light-source
// simulation (not this - see the class-level note in GameScene.cpp where
// the "lighting" map field is read). A map with no lighting mode set never
// creates one of these at all, so it costs nothing when unused.
class LightingOverlayItem : public QObject, public QGraphicsItem
{
    Q_OBJECT
    Q_INTERFACES(QGraphicsItem)

public:
    // `mode` is one of "sunrise"/"sunset"/"torch"/"cavern"/"mystical" - see
    // paint() for what each looks like. GameScene only ever constructs one
    // of these for a recognized mode string (see the "lighting" map field
    // in docs/SCRIPTING.md); an unrecognized mode paints nothing.
    explicit LightingOverlayItem(QString mode, qreal mapPixelWidth, qreal mapPixelHeight, QGraphicsItem *parent = nullptr);

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

    // Called from GameScene::onTick() rather than driven by an independent
    // QTimer - see TileMapItem::tick() for why (the two timers'
    // unsynchronized firings were implicated in a real, measured periodic
    // stutter). Invalidates just the visible portion of the map (see
    // VisibleSceneRect.h) at most once every kAnimIntervalMs.
    void tick();

private:
    QString m_mode;
    qreal m_width;
    qreal m_height;
    QElapsedTimer m_clock;
    qint64 m_lastUpdateMs = 0;
};
