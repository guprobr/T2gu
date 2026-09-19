#include "AssetPath.h"

#include <QCoreApplication>
#include <QDir>

namespace {
QString resolveAssetDir()
{
    const QString fromEnv = qEnvironmentVariable("T2GU_ASSET_DIR");
    if (!fromEnv.isEmpty() && QDir(fromEnv).exists())
        return QDir::cleanPath(fromEnv);

    const QString installed = QDir::cleanPath(QCoreApplication::applicationDirPath() + QStringLiteral("/../share/t2gu2/assets"));
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
