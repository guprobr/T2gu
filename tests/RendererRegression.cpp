#include <QApplication>
#include <QElapsedTimer>
#include <QGraphicsRectItem>
#include <QGraphicsScene>
#include <QImage>
#include <QLabel>
#include <QMainWindow>
#include <QPainter>
#include <QTimer>
#include <QWindow>

#include <functional>

#ifdef T2GU_HAS_OPENGL
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QOpenGLWidget>
#endif

#include "GameView.h"

namespace {
void check(bool condition, const char *message)
{
    if (!condition)
        qFatal("Renderer regression failed: %s", message);
}

#ifdef T2GU_HAS_OPENGL
void pumpEvents(int milliseconds)
{
    QEventLoop loop;
    QTimer::singleShot(milliseconds, &loop, &QEventLoop::quit);
    loop.exec();
}

void waitFor(const std::function<bool()> &condition, const char *message)
{
    QElapsedTimer deadline;
    deadline.start();
    while (!condition() && deadline.elapsed() < 5000)
        pumpEvents(10);
    if (!condition()) {
        qInfo() << "Application state:" << QGuiApplication::applicationState();
        for (QWidget *window : QApplication::topLevelWidgets())
            qInfo() << "Window:" << window->windowTitle() << "active=" << window->isActiveWindow()
                    << "visible=" << window->isVisible() << "updates=" << window->updatesEnabled();
    }
    check(condition(), message);
}
#endif

void checkFocusLifecycle()
{
#ifdef T2GU_HAS_OPENGL
    qunsetenv("T2GU_RENDERER");
    QMainWindow window;
    window.setWindowTitle("ShadowShine renderer regression");
    auto *view = new GameView(&window);
    check(view->usesOpenGL(), "focus regression requires desktop OpenGL");
    window.setCentralWidget(view);
    QGraphicsScene scene;
    scene.setSceneRect(0, 0, 2400, 1600);
    auto *moving = scene.addRect(1000, 700, 100, 100, Qt::NoPen, Qt::red);
    view->setScene(&scene);
    auto *hud = new QLabel("HUD", view);
    hud->setGeometry(20, 20, 240, 60);
    hud->setStyleSheet("background: white; color: black");
    int heartbeats = 0;
    int swaps = 0;
    QTimer timer;
    timer.setTimerType(Qt::PreciseTimer);
    QObject::connect(&timer, &QTimer::timeout, &window, [&] {
        ++heartbeats;
        moving->setPos(heartbeats % 100, 0);
        view->centerOn(1200 + heartbeats % 100, 800);
        // HUD changes must not keep top-level GL composition running.
        hud->setText(QString::number(heartbeats));
    });
    timer.start(16);
    auto *gl = static_cast<QOpenGLWidget *>(view->viewport());
    QObject::connect(gl, &QOpenGLWidget::frameSwapped, &window, [&] { ++swaps; });
    window.showMinimized();
    pumpEvents(200);
    check(view->usesOpenGL(), "a minimized startup retains OpenGL before its first paint");
    window.showMaximized();
    window.raise();
    window.activateWindow();
    waitFor([&] { return window.isActiveWindow() && window.updatesEnabled() && swaps > 2; },
            "foreground window initializes and presents frames");

    auto assertMinimized = [&] {
        waitFor([&] { return window.isMinimized() && window.windowHandle()
                             && !window.windowHandle()->isExposed(); },
                "focus loss hides the native window by minimizing it");
        check(window.updatesEnabled() && view->viewport()->updatesEnabled() && hud->updatesEnabled(),
              "minimization preserves normal Qt update handling");
        pumpEvents(100); // Allow the final already-submitted frame to settle.
        const int before = swaps;
        const int beat = heartbeats;
        pumpEvents(600);
        check(heartbeats > beat + 10, "GUI timers stay responsive while minimized");
        check(swaps == before, "background scene and HUD changes submit no GL frames");
    };
    auto assertResumed = [&] {
        const int before = swaps;
        window.showMaximized();
        window.raise();
        window.activateWindow();
        waitFor([&] { return !window.isMinimized() && window.isActiveWindow() && swaps > before + 2; },
                "foreground rendering resumes after restoring the window");
        check(window.updatesEnabled() && view->viewport()->updatesEnabled() && hud->updatesEnabled(),
              "restoration re-enables whole-window rendering");
        check(view->usesOpenGL() && gl->isValid(), "focus return preserves the GL renderer and context");
    };
    QWidget cover;
    cover.setWindowTitle("ShadowShine focus regression");
    cover.setScreen(window.screen());
    for (int cycle = 0; cycle < 4; ++cycle) {
        cover.showMaximized();
        cover.raise();
        cover.activateWindow();
        waitFor([&] { return !window.isActiveWindow(); }, "desktop focus leaves the game");
        check(!window.isMinimized() && window.updatesEnabled(),
              "focus loss neither forces minimization nor disables rendering");
        const int beat = heartbeats;
        pumpEvents(1500); // Exercise delayed compositor frame callbacks.
        check(heartbeats > beat + 10, "GUI timers remain responsive after focus loss");
        cover.hide();
        window.showMaximized();
        window.raise();
        window.activateWindow();
        waitFor([&] { return window.isActiveWindow(); }, "desktop focus returns to the game");
        assertResumed();
        window.showMinimized();
        assertMinimized();
        window.showMaximized();
        window.activateWindow();
        waitFor([&] { return window.isActiveWindow(); }, "restored game regains focus");
        assertResumed();
    }
    // An external caller's disabled updates must not be re-enabled by us.
    window.setUpdatesEnabled(false);
    QEvent deactivate(QEvent::WindowDeactivate);
    QEvent activate(QEvent::WindowActivate);
    QApplication::sendEvent(&window, &deactivate);
    QApplication::sendEvent(&window, &activate);
    check(!window.updatesEnabled(), "activation preserves externally disabled updates");
    window.setUpdatesEnabled(true);
    assertResumed();
    view->setScene(nullptr);
    qInfo("OpenGL focus/minimize regression passed; heartbeats=%d swaps=%d", heartbeats, swaps);
#else
    check(false, "focus regression requires an OpenGL-enabled build");
#endif
}

void checkPixels(GameView &view)
{
    QGraphicsScene scene;
    scene.setSceneRect(0, 0, 96, 96);
    scene.setBackgroundBrush(QColor(240, 240, 240));
    scene.addRect(12, 12, 24, 24, Qt::NoPen, QColor(200, 40, 60));
    scene.addRect(60, 60, 24, 24, Qt::NoPen, QColor(0, 0, 0, 128));
    view.setScene(&scene);
    view.setFrameShape(QFrame::NoFrame);
    view.setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    view.setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    view.resize(96, 96);
#ifdef T2GU_HAS_OPENGL
    // Preserve the FBO after composition for defined pixel readback. The
    // view still redraws complete frames via FullViewportUpdate.
    if (view.usesOpenGL())
        static_cast<QOpenGLWidget *>(view.viewport())->setUpdateBehavior(QOpenGLWidget::PartialUpdate);
#endif
    view.show();
    QElapsedTimer deadline;
    deadline.start();
    while ((!view.windowHandle() || !view.windowHandle()->isExposed()) && deadline.elapsed() < 5000)
        QCoreApplication::processEvents(QEventLoop::AllEvents, 10);
    check(view.windowHandle() && view.windowHandle()->isExposed(), "test window becomes exposed");
    view.viewport()->repaint();
    QCoreApplication::processEvents();
    QImage image;
#ifdef T2GU_HAS_OPENGL
    if (view.usesOpenGL()) {
        auto *gl = static_cast<QOpenGLWidget *>(view.viewport());
        check(gl->isValid(), "shown OpenGL viewport has valid resources");
        // grabFramebuffer() invokes QOpenGLWidget's paintGL(), which clears
        // a Graphics View viewport: its scene is drawn by QGraphicsView's
        // paint event instead. Read the already-painted FBO without rerendering.
        gl->makeCurrent();
        const qreal ratio = gl->devicePixelRatioF();
        QImage framebuffer(qRound(gl->width() * ratio), qRound(gl->height() * ratio), QImage::Format_RGBA8888);
        gl->context()->functions()->glReadPixels(0, 0, framebuffer.width(), framebuffer.height(),
                                                GL_RGBA, GL_UNSIGNED_BYTE, framebuffer.bits());
        gl->doneCurrent();
        image = framebuffer.flipped(Qt::Vertical);
        image.setDevicePixelRatio(ratio);
    } else
#endif
    {
        image = view.viewport()->grab().toImage();
    }
    check(!image.isNull(), "viewport produces an image");
    const qreal scale = image.devicePixelRatio();
    if (image.pixelColor(qRound(24 * scale), qRound(24 * scale)) != QColor(200, 40, 60)) {
        qInfo() << "Unexpected framebuffer:" << image.size() << scale
                << image.pixelColor(qRound(24 * scale), qRound(24 * scale));
    }
    check(image.pixelColor(qRound(24 * scale), qRound(24 * scale)) == QColor(200, 40, 60),
          "opaque scene art renders correctly");
    const QColor blended = image.pixelColor(qRound(72 * scale), qRound(72 * scale));
    check(qAbs(blended.red() - 120) <= 1 && blended.green() == blended.red()
              && blended.blue() == blended.red(),
          "translucent scene art blends with the background");
    view.hide();
    view.setScene(nullptr);
}
}

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    const QString mode = argc == 2 ? QString::fromLocal8Bit(argv[1]) : QString();
    if (mode == QLatin1String("--focus")) {
        checkFocusLifecycle();
        return 0;
    }
    if (mode == QLatin1String("--opengl") || mode == QLatin1String("--default")) {
        if (mode == QLatin1String("--default"))
            qunsetenv("T2GU_RENDERER");
        else
            qputenv("T2GU_RENDERER", "opengl");
        GameView view;
        check(view.usesOpenGL(), "desktop OpenGL backend is available");
        check(view.viewportUpdateMode() == QGraphicsView::FullViewportUpdate,
              "OpenGL uses complete viewport updates");
        checkPixels(view);
        check(view.usesOpenGL(), "OpenGL remains active after showing the viewport");
        if (mode == QLatin1String("--default")) {
            qputenv("T2GU_RENDERER", "   ");
            GameView emptyView;
            check(emptyView.usesOpenGL(), "empty renderer setting selects the OpenGL default");
            checkPixels(emptyView);
            qputenv("T2GU_RENDERER", "software");
            GameView softwareView;
            check(!softwareView.usesOpenGL(), "explicit software overrides the available OpenGL default");
            checkPixels(softwareView);
        }
        qInfo("OpenGL renderer regression passed");
        return 0;
    }
    check(argc == 1, "expected no arguments, --default, --opengl or --focus");
    qunsetenv("T2GU_RENDERER");
    GameView defaultView;
    check(!defaultView.usesOpenGL() && defaultView.viewportUpdateMode() == QGraphicsView::MinimalViewportUpdate,
          "unavailable default OpenGL falls back to software partial updates");
    checkPixels(defaultView);
    qputenv("T2GU_RENDERER", "   ");
    GameView emptyView;
    check(!emptyView.usesOpenGL(), "empty renderer setting also falls back when OpenGL is unavailable");
    qputenv("T2GU_RENDERER", " Software ");
    GameView explicitView;
    check(!explicitView.usesOpenGL(), "explicit software renderer accepts case and surrounding spaces");
    qputenv("T2GU_RENDERER", "unknown");
    GameView invalidView;
    check(!invalidView.usesOpenGL(), "unknown renderer falls back to software");
    qputenv("T2GU_RENDERER", "opengl");
    GameView fallbackView;
    // CTest uses offscreen, which cannot host QOpenGLWidget. This also
    // exercises a build configured without the optional OpenGL module.
    check(!fallbackView.usesOpenGL(), "unavailable OpenGL falls back before creating its viewport");
    checkPixels(fallbackView);
    qInfo("Renderer selection regressions passed");
    return 0;
}
