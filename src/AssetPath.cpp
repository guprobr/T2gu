#include "AssetPath.h"

#include <QCoreApplication>
#include <QDir>

namespace {
QString resolveAssetDir()
{
    const QString fromEnv = qEnvironmentVariable("T2GU_ASSET_DIR");
    if (!fromEnv.isEmpty() && QDir(fromEnv).exists())
        return QDir::cleanPath(fromEnv);

    const QString configured = QStringLiteral(T2GU_INSTALL_ASSET_PATH);
    const QString installed = QDir::cleanPath(QDir::isAbsolutePath(configured)
        ? configured
        : QDir(QCoreApplication::applicationDirPath()).absoluteFilePath(configured));
    if (QDir(installed).exists())
        return installed;

    return QStringLiteral(ASSET_DIR);
}
}

QString assetDir()
{
    static const QString dir = resolveAssetDir();
    return dir;
}

QString assetPath(const QString &relativePath)
{
    return assetDir() + relativePath;
}
