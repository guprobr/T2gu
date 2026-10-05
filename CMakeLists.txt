cmake_minimum_required(VERSION 3.16)

# Defaults to Release (-O3 -DNDEBUG) when nothing else is requested -
# without this, a plain `cmake -S . -B build` silently produces an
# unoptimized build (CMake's own default build type is empty, not Debug
# or Release), and that's easy to lose track of across a `rm -rf build`/
# reconfigure, exactly as happened once already in this project's history.
# Still overridable the normal way (-DCMAKE_BUILD_TYPE=Debug) for anyone
# who actually wants that.
if (NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

project(T2gu2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

# TileMapItem uses QImage::flipped(), introduced in Qt 6.9.
find_package(Qt6 6.9 REQUIRED COMPONENTS Widgets Qml Multimedia)

option(T2GU_OPENGL_RENDERER "Build the optional OpenGL viewport when available" ON)
if (T2GU_OPENGL_RENDERER)
    find_package(Qt6 6.9 QUIET COMPONENTS OpenGLWidgets)
    if (TARGET Qt6::OpenGLWidgets)
        set(T2GU_RENDERER_LIBRARIES Qt6::OpenGLWidgets)
        set(T2GU_RENDERER_DEFINITIONS T2GU_HAS_OPENGL=1)
    else()
        message(STATUS "Qt OpenGLWidgets unavailable; building software renderer only")
    endif()
endif()

include(GNUInstallDirs)
# Relative GNUInstallDirs layouts follow a relocated install prefix. An
# explicitly absolute directory keeps its configured, fixed location.
if (IS_ABSOLUTE "${CMAKE_INSTALL_BINDIR}" OR IS_ABSOLUTE "${CMAKE_INSTALL_DATADIR}")
    set(T2GU_INSTALL_ASSET_PATH "${CMAKE_INSTALL_FULL_DATADIR}/t2gu2/assets")
else()
    file(RELATIVE_PATH T2GU_INSTALL_ASSET_PATH
         "${CMAKE_INSTALL_FULL_BINDIR}" "${CMAKE_INSTALL_FULL_DATADIR}/t2gu2/assets")
endif()
set(T2GU_ASSET_DEFINITIONS
    ASSET_DIR="${CMAKE_SOURCE_DIR}/assets"
    T2GU_INSTALL_ASSET_PATH="${T2GU_INSTALL_ASSET_PATH}")

add_executable(T2gu2
    src/app/MainWindow.cpp
    src/app/MainWindow.h
    src/app/Version.h
    src/app/main.cpp

    src/assets/AssetPath.cpp
    src/assets/AssetPath.h
    src/assets/SpriteSheet.cpp
    src/assets/SpriteSheet.h
    src/assets/TileSheet.cpp
    src/assets/TileSheet.h

    src/audio/AudioManager.cpp
    src/audio/AudioManager.h

    src/game/BlockingGrid.h
    src/game/Character.cpp
    src/game/Character.h
    src/game/GameScene.cpp
    src/game/GameScene.h
    src/game/GameState.h
    src/game/Prop.cpp
    src/game/Prop.h
    src/game/TileMap.cpp
    src/game/TileMap.h

    src/persistence/SaveData.cpp
    src/persistence/SaveData.h

    src/rendering/FireballItem.cpp
    src/rendering/FireballItem.h
    src/rendering/GameView.cpp
    src/rendering/GameView.h
    src/rendering/LevelUpTextItem.cpp
    src/rendering/LevelUpTextItem.h
    src/rendering/LightingOverlayItem.cpp
    src/rendering/LightingOverlayItem.h
    src/rendering/PaintMetrics.h
    src/rendering/SceneLayers.h
    src/rendering/TileMapItem.cpp
    src/rendering/TileMapItem.h
    src/rendering/VisibleSceneRect.h

    src/scripting/ScriptBridge.cpp
    src/scripting/ScriptBridge.h
    src/scripting/ScriptEngine.cpp
    src/scripting/ScriptEngine.h

    src/ui/DeathMenuWidget.cpp
    src/ui/DeathMenuWidget.h
    src/ui/DialogueBoxWidget.cpp
    src/ui/DialogueBoxWidget.h
    src/ui/InventoryWidget.cpp
    src/ui/InventoryWidget.h
    src/ui/LoadingOverlayWidget.cpp
    src/ui/LoadingOverlayWidget.h
    src/ui/SelectionInfoWidget.cpp
    src/ui/SelectionInfoWidget.h
    src/ui/StatusMessageWidget.cpp
    src/ui/StatusMessageWidget.h
)

target_include_directories(T2gu2 PRIVATE src)
target_link_libraries(T2gu2 PRIVATE Qt6::Widgets Qt6::Qml Qt6::Multimedia ${T2GU_RENDERER_LIBRARIES})
target_compile_definitions(T2gu2 PRIVATE ${T2GU_ASSET_DEFINITIONS} ${T2GU_RENDERER_DEFINITIONS})

# Small opt-in regressions for engine behavior, renderer paths and story
# progression. Normal builds omit these regression targets.
option(T2GU_BUILD_TESTS "Build engine regression checks" OFF)
if (T2GU_BUILD_TESTS)
    enable_testing()
    get_target_property(T2GU_ENGINE_SOURCES T2gu2 SOURCES)
    list(REMOVE_ITEM T2GU_ENGINE_SOURCES src/app/main.cpp)
    add_executable(T2guRegression tests/EngineRegression.cpp ${T2GU_ENGINE_SOURCES})
    target_include_directories(T2guRegression PRIVATE src)
    target_link_libraries(T2guRegression PRIVATE Qt6::Widgets Qt6::Qml Qt6::Multimedia ${T2GU_RENDERER_LIBRARIES})
    target_compile_definitions(T2guRegression PRIVATE ${T2GU_ASSET_DEFINITIONS} ${T2GU_RENDERER_DEFINITIONS})
    add_test(NAME engine_regressions COMMAND T2guRegression)
    set_tests_properties(engine_regressions PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen;T2GU_RENDERER=software" TIMEOUT 60)
    add_executable(T2guRendererRegression tests/RendererRegression.cpp src/rendering/GameView.cpp src/rendering/GameView.h)
    target_include_directories(T2guRendererRegression PRIVATE src)
    target_link_libraries(T2guRendererRegression PRIVATE Qt6::Widgets ${T2GU_RENDERER_LIBRARIES})
    target_compile_definitions(T2guRendererRegression PRIVATE ${T2GU_RENDERER_DEFINITIONS})
    add_test(NAME renderer_selection COMMAND T2guRendererRegression)
    set_tests_properties(renderer_selection PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT 15)
    add_executable(T2guAssetProbe tests/AssetPathProbe.cpp src/assets/AssetPath.cpp)
    target_include_directories(T2guAssetProbe PRIVATE src)
    target_link_libraries(T2guAssetProbe PRIVATE Qt6::Core)
    target_compile_definitions(T2guAssetProbe PRIVATE ${T2GU_ASSET_DEFINITIONS})
    find_package(Python3 QUIET COMPONENTS Interpreter)
    if (Python3_Interpreter_FOUND)
        add_test(NAME asset_paths
            COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/asset_path_regression.py
                    --probe $<TARGET_FILE:T2guAssetProbe>
                    --install-path "${T2GU_INSTALL_ASSET_PATH}"
                    --bindir "${CMAKE_INSTALL_BINDIR}"
                    --datadir "${CMAKE_INSTALL_DATADIR}"
                    --source-assets "${CMAKE_SOURCE_DIR}/assets")
        set_tests_properties(asset_paths PROPERTIES TIMEOUT 30)
        if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
            add_test(NAME chapter_smoke_guard
                COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/chapter_smoke_regression.py)
            set_tests_properties(chapter_smoke_guard PROPERTIES TIMEOUT 30)
        endif()
    endif()
    find_program(T2GU_NODE_EXECUTABLE node)
    if (T2GU_NODE_EXECUTABLE)
        add_test(NAME chapter6_progression
                 COMMAND ${T2GU_NODE_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/chapter6_regression.js)
        add_test(NAME chapter15_reload
                 COMMAND ${T2GU_NODE_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/chapter15_regression.js)
        add_test(NAME chapter25_boss
                 COMMAND ${T2GU_NODE_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/chapter25_regression.js)
    endif()
endif()

# Already builds Release/-O3 by default (see CMAKE_BUILD_TYPE) - these go a
# step further: -march=native lets the compiler use whatever instruction
# set the build machine's own CPU actually supports (AVX2/FMA/etc.)
# instead of a portable baseline, and interprocedural (link-time)
# optimization lets it inline/optimize across the .cpp file boundaries
# that -O3 alone can't see through (e.g. GameScene.cpp calling into
# Character.cpp's hot per-tick functions). Only applied for Release builds
# - -march=native ties the binary to this build machine's specific CPU, a
# fine tradeoff for a locally-built desktop game never redistributed to a
# different machine, but wrong for anything that would be.
option(T2GU_NATIVE_CPU "Optimize Release builds for the build machine's CPU" ON)
if (CMAKE_BUILD_TYPE STREQUAL "Release")
    if (T2GU_NATIVE_CPU)
        include(CheckCXXCompilerFlag)
        check_cxx_compiler_flag("-march=native" T2GU_HAS_MARCH_NATIVE)
        if (T2GU_HAS_MARCH_NATIVE)
            target_compile_options(T2gu2 PRIVATE -march=native)
        endif()
    endif()
    include(CheckIPOSupported)
    check_ipo_supported(RESULT T2GU_IPO_SUPPORTED)
    if (T2GU_IPO_SUPPORTED)
        set_property(TARGET T2gu2 PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
    endif()
endif()


# ---- Install (Linux): `cmake --install build` / `make install` -------------
#
#   cmake -S . -B build -DCMAKE_INSTALL_PREFIX=$HOME/.local   # default: /usr/local
#   cmake --build build && cmake --install build              # sudo for /usr/local
#
# Installs the binary, the whole assets/ tree (~1 GB), the app icons and the
# launcher entry. The binary finds its assets at the configured data directory
# on its own (see src/assets/AssetPath.h), so the install does not depend on the
# source tree staying where it was built. Set the prefix when configuring:
# the launcher's Exec= line is filled in from it here, at configure time.
# (Use -DT2GU_NATIVE_CPU=OFF when distributing to other CPUs.)

install(TARGETS T2gu2 RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY assets/ DESTINATION ${CMAKE_INSTALL_DATADIR}/t2gu2/assets)

configure_file(packaging/t2gu2.desktop.in ${CMAKE_BINARY_DIR}/t2gu2.desktop @ONLY)
install(FILES ${CMAKE_BINARY_DIR}/t2gu2.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)

foreach(size 32 64 128 256 512)
    install(FILES assets/icons/app_icon_${size}.png
            DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/${size}x${size}/apps
            RENAME t2gu2.png)
endforeach()
