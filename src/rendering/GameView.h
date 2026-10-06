#pragma once

#include <QGraphicsView>
#include <QElapsedTimer>
#include <QVector>
#include <QChronoTimer>
#include <QPointer>

#include "rendering/PaintMetrics.h"

// Renderer selection is a launch-time option. Gameplay and chrome widgets
// continue to use the same view/scene regardless of its viewport backend.
class GameView : public QGraphicsView
{
public:
    // Call before QApplication: Qt can initialize the driver during startup.
    static void configureRendererEnvironment();
    explicit GameView(QWidget *parent = nullptr);
    bool usesOpenGL() const { return m_usesOpenGL; }
    int maximumFrameRate() const { return m_maximumFrameRate; }

protected:
    void paintEvent(QPaintEvent *event) override;
    void scrollContentsBy(int dx, int dy) override;

private:
    void configureRenderer();
    void configureFrameLimit();
    void useSoftwareViewport();
    void recordPaint(qint64 startedNs, qint64 finishedNs);
    bool m_usesOpenGL = false;
    int m_maximumFrameRate = 0; // zero retains scene-driven repaint scheduling
    QChronoTimer m_frameTimer;
    QPointer<QGraphicsScene> m_frameScene;
    QMetaObject::Connection m_sceneChangedConnection;
    bool m_frameDirty = true;
    QElapsedTimer m_profileClock;
    qint64 m_previousPaintNs = -1;
    qint64 m_profileReportNs = 0;
    QVector<double> m_paintDurations;
    QVector<double> m_paintIntervals;
    PaintMetrics::Frame m_profileTotals;
};
