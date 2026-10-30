import {watch} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {layerConfigValidate} from './config.js';
import {layerProjectBuild} from './project-build.js';

/**
 * @param {{
 *     rootDirectory: string,
 *     config: unknown,
 *     debounceMs?: number,
 *     watchCreate?: typeof watch,
 *     onBuild?: (buildResult: Awaited<ReturnType<typeof layerProjectBuild>>) => void | Promise<void>,
 *     onError?: (buildError: unknown) => void
 * }} developmentOptions
 */
export async function layerDevelopmentWatchCreate(developmentOptions) {
    const rootDirectory = path.resolve(developmentOptions.rootDirectory);
    const configData = layerConfigValidate(developmentOptions.config);
    const debounceMs = developmentOptions.debounceMs ?? 75;
    const watchCreate = developmentOptions.watchCreate ?? watch;

    if (!Number.isInteger(debounceMs) || debounceMs < 10 || debounceMs > 5000) {
        throw new TypeError('Development debounceMs must be between 10 and 5000.');

    }

    let closedStatus = false;
    let buildRunningStatus = false;
    let rebuildRequestedStatus = false;
    let debounceTimer = /** @type {NodeJS.Timeout | null} */ (null);
    const watchers = /** @type {import('node:fs').FSWatcher[]} */ ([]);

    async function buildExecute(initialBuildStatus = false) {
        if (closedStatus) {
            return;

        }

        if (buildRunningStatus) {
            rebuildRequestedStatus = true;

            return;

        }

        buildRunningStatus = true;

        try {
            //Rebuilding the complete deterministic artifact set after a source change.
            const buildResult = await layerProjectBuild({
                rootDirectory,
                config: configData,
                mode: 'development'
            });
            await developmentOptions.onBuild?.(buildResult);

        } catch (buildError) {
            developmentOptions.onError?.(buildError);

            //Stopping startup when no valid artifact set exists yet.
            if (initialBuildStatus) {
                throw buildError;

            }

        } finally {
            buildRunningStatus = false;

            if (rebuildRequestedStatus && !closedStatus) {
                rebuildRequestedStatus = false;
                await buildExecute();

            }

        }

    }

    function buildSchedule() {
        //Scheduling one bounded rebuild after rapid file changes.
        if (closedStatus) {
            return;

        }

        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);

        }

        debounceTimer = setTimeout(function developmentBuildDelayComplete() {
            //Rebuilding after the current burst of file-system events settles.
            debounceTimer = null;
            void buildExecute();

        }, debounceMs);

    }

    //Producing one complete build before file watchers report readiness.
    await buildExecute(true);

    for (const directoryName of [configData.sourceDirectory, configData.publicDirectory]) {
        const watchDirectory = path.resolve(rootDirectory, directoryName);
        const watchStatus = await stat(watchDirectory).catch(function watchDirectoryMissing(watchError) {
            if (/** @type {NodeJS.ErrnoException} */ (watchError).code === 'ENOENT') {
                return null;

            }

            throw watchError;

        });

        if (watchStatus?.isDirectory() !== true) {
            continue;

        }

        //Watching only configured project source and public directories.
        const watcherData = watchCreate(watchDirectory, {
            recursive: true
        }, function developmentFileChangeHandle() {
            //Scheduling a new build without running overlapping compilers.
            buildSchedule();

        });
        watchers.push(watcherData);

    }

    return Object.freeze({
        rootDirectory,
        close() {
            //Closing all watchers and cancelling the pending rebuild.
            if (closedStatus) {
                return false;

            }

            closedStatus = true;

            if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
                debounceTimer = null;

            }

            for (const watcherData of watchers) {
                watcherData.close();

            }

            return true;

        }
    });

}
