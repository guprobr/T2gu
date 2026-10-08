#include <QApplication>
#include <QEventLoop>
#include <QFont>
#include <QIcon>
#include <QPainter>
#include <QPixmap>
#include <QSplashScreen>
#include <QTimer>
#include <QThread>
#include <QScopedValueRollback>
#include <QMetaEnum>

#include "assets/AssetPath.h"
#include "rendering/GameView.h"
#include "app/MainWindow.h"
#include "app/Version.h"
#include "app/RuntimeMetrics.h"

namespace {
// Time outer GUI event deliveries too: queued script/audio callbacks and
// input hit testing can stall between simulation ticks. Receiver metadata
// must be captured before delivery, since the callback may delete it.
class ProfiledApplication final : public QApplication
{
public:
    using QApplication::QApplication;
    bool notify(QObject *receiver, QEvent *event) override
    {
        if (!RuntimeMetrics::enabled() || QThread::currentThread() != thread())
            return QApplication::notify(receiver, event);
        if (event->type() == QEvent::UpdateRequest) {
            // Keep nested window composition visible inside a scene MetaCall.
            const RuntimeMetrics::Sample sample(RuntimeMetrics::WindowUpdate);
            return notifyProfiled(receiver, event);
        }
        if (event->type() == QEvent::Paint && receiver->isWidgetType()
                && !receiver->inherits("QOpenGLWidget")) {
            // Parent backgrounds and chrome use the raster backing store.
            // Include nested paint deliveries, excluding the GL viewport.
            const RuntimeMetrics::Sample sample(RuntimeMetrics::WidgetPaint);
            return notifyProfiled(receiver, event);
        }
        return notifyProfiled(receiver, event);
    }
private:
    bool notifyProfiled(QObject *receiver, QEvent *event)
    {
        if (m_notifying)
            return QApplication::notify(receiver, event);
        QScopedValueRollback<bool> notifying(m_notifying, true);
        const QString receiverClass = QString::fromLatin1(receiver->metaObject()->className());
        const QEvent::Type type = event->type();
        const quint64 generation = RuntimeMetrics::window().generation;
        QElapsedTimer clock;
        clock.start();
        const bool result = QApplication::notify(receiver, event);
        const qint64 elapsed = clock.nsecsElapsed();
        // A load/resume resets the session inside its readiness callback;
        // don't then charge that entire loading event to the new session.
        if (elapsed >= 16000000 && RuntimeMetrics::window().generation == generation) {
            auto &w = RuntimeMetrics::window();
            ++w.slowEvents;
            if (elapsed > w.slowestEvent) {
                w.slowestEvent = elapsed;
                const char *name = QMetaEnum::fromType<QEvent::Type>().valueToKey(type);
                w.eventDescription = QStringLiteral("receiver=%1 event=%2(%3)")
                    .arg(receiverClass, QString::fromLatin1(name ? name : "unknown")).arg(int(type));
            }
        }
        return result;
    }
    bool m_notifying = false;
};

// Held on screen for a fixed minimum duration below, same reasoning as
// level-transition overlay: a warm start can finish quickly enough that
// the splash would flash before anyone could read it. Cold sprite decoding
// can take much longer; chapter loading has its own readiness-bound overlay.
constexpr int kSplashMinDurationMs = 1200;

QPixmap buildSplashPixmap()
{
    QPixmap pixmap(480, 320);
    pixmap.fill(Qt::black);

    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const QPixmap appIcon(assetPath(QStringLiteral("/icons/app_icon_128.png")));
    if (!appIcon.isNull())
        painter.drawPixmap((pixmap.width() - appIcon.width()) / 2, 24, appIcon);

    painter.setPen(QColor(0xff, 0xd7, 0x00)); // same gold/yellow as the loading-transition screen
    QFont font = painter.font();
    font.setPointSize(28);
    font.setBold(true);
    painter.setFont(font);
    painter.drawText(QRect(0, 190, pixmap.width(), 60), Qt::AlignCenter, QStringLiteral("ShadowShine"));

    // Same gold, dimmed rather than a different color - reads as part of
    // the title lockup, not a separate debug/UI label.
    painter.setPen(QColor(0xff, 0xd7, 0x00, 160));
    QFont versionFont = painter.font();
    versionFont.setPointSize(12);
    versionFont.setBold(false);
    painter.setFont(versionFont);
    painter.drawText(QRect(0, 248, pixmap.width(), 24), Qt::AlignCenter, QString::fromLatin1(kGameVersion));

    painter.end();
    return pixmap;
}
}

int main(int argc, char *argv[])
{
    GameView::configureRendererEnvironment();
    ProfiledApplication app(argc, argv);
    app.setApplicationVersion(QString::fromLatin1(kGameVersion));

    // Shown before MainWindow (and the actual first chapter it loads)
    // exist at all - a black screen naming the game, not a menu/UI, per
    // the request. Uses the same app-icon artwork as the window icon
    // itself for visual continuity rather than being unrelated branding.
    QSplashScreen splash(buildSplashPixmap());
    splash.show();
    app.processEvents();
    {
        QEventLoop loop;
        QTimer::singleShot(kSplashMinDurationMs, &loop, &QEventLoop::quit);
        loop.exec();
    }

    // The in-process icon below fixes the window/titlebar icon directly. A
    // taskbar/app switcher that only trusts desktop-file-based icon lookups
    // (some Wayland compositors do) additionally needs the installed
    // t2gu2.desktop (`make install`, see packaging/t2gu2.desktop.in), and
    // the app-id has to match its name - hence setDesktopFileName().
    app.setDesktopFileName(QStringLiteral("t2gu2"));
    QIcon icon;
    icon.addFile(assetPath(QStringLiteral("/icons/app_icon_32.png")));
    icon.addFile(assetPath(QStringLiteral("/icons/app_icon_64.png")));
    icon.addFile(assetPath(QStringLiteral("/icons/app_icon_128.png")));
    icon.addFile(assetPath(QStringLiteral("/icons/app_icon_256.png")));
    app.setWindowIcon(icon);

    MainWindow window;
    splash.finish(&window);
    window.showMaximized();

    if (qEnvironmentVariableIsSet("T2GU_SCREENSHOT_PATH")) {
        QTimer::singleShot(2500, &window, [&window] {
            window.grab().save(qEnvironmentVariable("T2GU_SCREENSHOT_PATH"));
        });
    }

    return app.exec();
}
