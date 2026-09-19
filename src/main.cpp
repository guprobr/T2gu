#include <QApplication>
#include <QEventLoop>
#include <QFont>
#include <QIcon>
#include <QPainter>
#include <QPixmap>
#include <QSplashScreen>
#include <QTimer>

#include "AssetPath.h"
#include "MainWindow.h"
#include "Version.h"

namespace {
// Held on screen for a fixed minimum duration below, same reasoning as
// MainWindow::blockFor() for level transitions - MainWindow's own
// construction (which synchronously loads the first chapter) is fast
// enough that without an artificial pause, this would flash and vanish
// before anyone could read it.
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

    painter.end();
    return pixmap;
}
}

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
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
