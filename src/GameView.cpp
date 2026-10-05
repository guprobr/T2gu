#include "GameView.h"

#include <QDebug>
#include <QGuiApplication>
#include <QTimer>
#include <algorithm>
#include <cmath>

#ifdef T2GU_HAS_OPENGL
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QOpenGLWidget>
#include <QSurfaceFormat>

#ifdef Q_OS_LINUX
#include <QDir>
#include <QFile>
#endif

namespace {
class OpenGLViewport final : public QOpenGLWidget
{
protected:
    void initializeGL() override
    {
        QOpenGLFunctions *functions = context()->functions();
        qInfo().nospace() << "T2gu renderer: opengl; vendor="
                         << reinterpret_cast<const char *>(functions->glGetString(GL_VENDOR))
                         << "; device="
                         << reinterpret_cast<const char *>(functions->glGetString(GL_RENDERER))
                         << "; version="
                         << reinterpret_cast<const char *>(functions->glGetString(GL_VERSION));
    }
};

bool canCreateContext(const QSurfaceFormat &format)
{
    // Fail before adding an OpenGL widget to the top-level window. This
    // avoids changing its composition path on machines without a context.
    QOpenGLContext context;
    context.setFormat(format);
    if (!context.create())
        return false;
    QOffscreenSurface surface;
    surface.setFormat(context.format());
    surface.create();
    if (!surface.isValid() || !context.makeCurrent(&surface))
        return false;
    context.doneCurrent();
    return true;
}
}
#endif

void GameView::configureRendererEnvironment()
{
#if defined(T2GU_HAS_OPENGL) && defined(Q_OS_LINUX)
    const QString requested = qEnvironmentVariable("T2GU_RENDERER").trimmed().toLower();
    if (!requested.isEmpty() && requested != QLatin1String("opengl"))
        return;
    if (qEnvironmentVariableIsSet("always_flush_cache"))
        return;
    const QString platform = qEnvironmentVariable("QT_QPA_PLATFORM").section(QLatin1Char(':'), 0, 0);
    if (platform == QLatin1String("offscreen") || platform == QLatin1String("minimal"))
        return;

    // Scope the workaround to the PCI adapter from the recorded hangs.
    // Detection must precede even Qt's first GL context: Mesa caches options
    // when creating its screen, so setting this in initializeGL is too late.
    const QDir drm(QStringLiteral("/sys/class/drm"));
    const auto readId = [](const QString &path) {
        QFile file(path);
        return file.open(QIODevice::ReadOnly) ? file.readAll().trimmed() : QByteArray();
    };
    const QStringList nodes = drm.entryList({QStringLiteral("renderD*")}, QDir::Dirs);
    for (const QString &node : nodes) {
        const QString device = drm.filePath(node + QStringLiteral("/device/"));
        if (readId(device + QStringLiteral("vendor")) != "0x8086"
                || readId(device + QStringLiteral("device")) != "0x9a49")
            continue;

        // In Mesa 26.0.8 Iris, DEBUG_STALL enables this exact option. It
        // flushes/invalidates caches around draws and blits inside a batch;
        // waiting once at the end of a frame does not reproduce that behavior.
        if (qputenv("always_flush_cache", "true"))
            qInfo("T2gu OpenGL: requested Mesa per-draw cache flushing for Intel Tiger Lake (stall-equivalent)");
        else
            qWarning("T2gu OpenGL: could not request Mesa per-draw cache flushing");
        return;
    }
#endif
}

GameView::GameView(QWidget *parent)
    : QGraphicsView(parent)
{
    if (PaintMetrics::enabled())
        m_profileClock.start();
    QString requested = qEnvironmentVariable("T2GU_RENDERER").trimmed().toLower();
    if (requested.isEmpty())
        requested = QStringLiteral("opengl");
    if (requested == QLatin1String("software")) {
        qInfo("T2gu renderer: software");
        return;
    }
    if (requested != QLatin1String("opengl")) {
        qWarning().noquote() << "Unknown T2GU_RENDERER:" << requested << "- using software";
        return;
    }
#ifdef T2GU_HAS_OPENGL
    const QString platform = QGuiApplication::platformName();
    if (platform == QLatin1String("offscreen") || platform == QLatin1String("minimal")) {
        qWarning().noquote() << "OpenGL viewport unavailable on" << platform << "- using software";
        return;
    }
    QSurfaceFormat format = QSurfaceFormat::defaultFormat();
    format.setSamples(0);
    format.setSwapInterval(1);
    if (!canCreateContext(format)) {
        qWarning("OpenGL context unavailable - using software");
        return;
    }
    auto *gl = new OpenGLViewport;
    gl->setFormat(format);
    setViewport(gl);
    // GL viewports require complete frames, including when the camera pans.
    setViewportUpdateMode(QGraphicsView::FullViewportUpdate);
    m_usesOpenGL = true;
#else
    qWarning("OpenGL viewport not built - using software");
#endif
}

void GameView::useSoftwareViewport()
{
    setViewport(new QWidget);
    setViewportUpdateMode(QGraphicsView::MinimalViewportUpdate);
    m_usesOpenGL = false;
    qWarning("OpenGL viewport initialization failed - using software");
}

void GameView::paintEvent(QPaintEvent *event)
{
    qint64 startedNs = 0;
    if (PaintMetrics::enabled()) {
        startedNs = m_profileClock.nsecsElapsed();
        PaintMetrics::currentFrame() = {};
    }
    QGraphicsView::paintEvent(event);
    if (PaintMetrics::enabled())
        recordPaint(startedNs, m_profileClock.nsecsElapsed());
#ifdef T2GU_HAS_OPENGL
    if (m_usesOpenGL && !static_cast<QOpenGLWidget *>(viewport())->isValid()) {
        // Validate after an actual paint attempt. A minimized startup may
        // not initialize GL until its first restoration.
        QTimer::singleShot(0, this, [this] {
            if (m_usesOpenGL && window()->isVisible() && !window()->isMinimized()
                    && !static_cast<QOpenGLWidget *>(viewport())->isValid())
                useSoftwareViewport();
        });
    }
#endif
}

void GameView::recordPaint(qint64 startedNs, qint64 finishedNs)
{
    m_paintDurations.append((finishedNs - startedNs) / 1000000.0);
    if (m_previousPaintNs >= 0)
        m_paintIntervals.append((startedNs - m_previousPaintNs) / 1000000.0);
    m_previousPaintNs = startedNs;
    const auto &frame = PaintMetrics::currentFrame();
    for (int i = 0; i < PaintMetrics::CategoryCount; ++i) {
        m_profileTotals.nanoseconds[i] += frame.nanoseconds[i];
        m_profileTotals.calls[i] += frame.calls[i];
    }
    m_profileTotals.waterBuilds += frame.waterBuilds;
    // Bound the sample storage too: a suspended clock need not produce a
    // log every frame, and long idle gaps are meaningful interval samples.
    if (finishedNs - m_profileReportNs < 3000000000LL && m_paintDurations.size() < 1024)
        return;

    const auto distribution = [](QVector<double> samples) {
        if (samples.isEmpty())
            return QStringLiteral("n/a");
        std::sort(samples.begin(), samples.end());
        const auto percentile = [&samples](double fraction) {
            const qsizetype index = std::max<qsizetype>(0, qsizetype(std::ceil(samples.size() * fraction)) - 1);
            return samples.at(index);
        };
        return QStringLiteral("%1/%2/%3 ms").arg(percentile(0.5), 0, 'f', 2)
                .arg(percentile(0.95), 0, 'f', 2).arg(samples.last(), 0, 'f', 2);
    };
    const double count = m_paintDurations.size();
    QStringList parts{
        QStringLiteral("T2gu paint profile: backend=%1; frames=%2").arg(m_usesOpenGL ? "opengl" : "software").arg(int(count)),
        QStringLiteral("interval p50/p95/max=%1").arg(distribution(m_paintIntervals)),
        QStringLiteral("CPU scene paint p50/p95/max=%1").arg(distribution(m_paintDurations))
    };
    const std::array<const char *, PaintMetrics::CategoryCount> labels{
        "tiles", "props", "overflow shadows", "characters", "lighting"
    };
    for (int i = 0; i < PaintMetrics::CategoryCount; ++i) {
        parts.append(QStringLiteral("mean %1=%2 ms/%3 calls")
                .arg(QLatin1String(labels[i]))
                .arg(m_profileTotals.nanoseconds[i] / count / 1000000.0, 0, 'f', 2)
                .arg(m_profileTotals.calls[i] / count, 0, 'f', 1));
    }
    parts.append(QStringLiteral("water frames built=%1").arg(m_profileTotals.waterBuilds));
    qInfo().noquote() << parts.join(QStringLiteral("; "));
    m_profileReportNs = finishedNs;
    m_paintDurations.clear();
    m_paintIntervals.clear();
    m_profileTotals = {};
}
