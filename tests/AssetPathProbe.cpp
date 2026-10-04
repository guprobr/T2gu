#include "AssetPath.h"

#include <QCoreApplication>
#include <QDir>
#include <QTextStream>

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    const auto args = app.arguments();
    if (args.size() != 2)
        return 2;
    const QString expected = QDir::cleanPath(args.at(1));
    if (assetDir() != expected || assetPath(QStringLiteral("/maps/probe.json"))
            != expected + QStringLiteral("/maps/probe.json")) {
        QTextStream(stderr) << "Expected " << expected << ", resolved " << assetDir() << '\n';
        return 1;
    }
    return 0;
}
