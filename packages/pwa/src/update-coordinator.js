import {LayerPwaError} from './pwa-error.js';
import {
    layerVersionCompare,
    layerVersionManifestValidate
} from './version-manifest.js';

/**
 * @param {object} coordinatorOptions
 * @param {string} coordinatorOptions.currentVersion
 * @param {number} coordinatorOptions.protocolVersion
 * @param {() => Promise<unknown>} coordinatorOptions.manifestLoad
 * @param {() => Promise<ServiceWorkerRegistration>} coordinatorOptions.registrationGet
 * @param {() => Promise<void>} coordinatorOptions.localStateSave
 * @param {() => void} coordinatorOptions.reload
 * @param {ServiceWorkerContainer} coordinatorOptions.serviceWorkerContainer
 * @param {Storage} [coordinatorOptions.sessionStorage]
 * @param {number} [coordinatorOptions.activationTimeoutMs]
 * @param {number} [coordinatorOptions.maximumBootAttempts]
 */
export function layerUpdateCoordinatorCreate(coordinatorOptions) {
    const activationTimeoutMs = coordinatorOptions.activationTimeoutMs ?? 15000;
    const maximumBootAttempts = coordinatorOptions.maximumBootAttempts ?? 2;
    const bootMarkerKey = 'layer:update-boot-attempts';
    let checkedManifest = /** @type {ReturnType<typeof layerVersionManifestValidate> | null} */ (null);
    let checkedRegistration = /** @type {ServiceWorkerRegistration | null} */ (null);

    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(coordinatorOptions.currentVersion) ||
        !Number.isInteger(coordinatorOptions.protocolVersion) || coordinatorOptions.protocolVersion < 1 ||
        !Number.isInteger(activationTimeoutMs) || activationTimeoutMs < 1000 || activationTimeoutMs > 120000 ||
        !Number.isInteger(maximumBootAttempts) || maximumBootAttempts < 1 || maximumBootAttempts > 10) {
        throw new TypeError('Update coordinator configuration is invalid.');

    }

    return Object.freeze({
        async check() {
            //Loading and validating the complete update contract before registration work.
            const manifest = layerVersionManifestValidate(await coordinatorOptions.manifestLoad());
            const protocolCompatible = coordinatorOptions.protocolVersion >= manifest.protocolMin &&
                coordinatorOptions.protocolVersion <= manifest.protocolMax;
            const updateAvailable = layerVersionCompare(manifest.appVersion, coordinatorOptions.currentVersion) > 0;
            const criticalUpdate = manifest.minVersion !== null &&
                layerVersionCompare(coordinatorOptions.currentVersion, manifest.minVersion) < 0;

            if (!protocolCompatible) {
                throw new LayerPwaError('PWA_PROTOCOL_INCOMPATIBLE', 'The available application version does not support this protocol.');

            }

            checkedManifest = manifest;
            checkedRegistration = await coordinatorOptions.registrationGet();

            if (updateAvailable) {
                await checkedRegistration.update();

            }

            return Object.freeze({
                updateAvailable,
                criticalUpdate,
                currentVersion: coordinatorOptions.currentVersion,
                availableVersion: manifest.appVersion,
                waiting: checkedRegistration.waiting !== null
            });

        },

        async activate() {
            if (checkedManifest === null || checkedRegistration === null || checkedRegistration.waiting === null) {
                throw new LayerPwaError('PWA_UPDATE_NOT_READY', 'No verified waiting update is ready for activation.');

            }

            await coordinatorOptions.localStateSave();
            const controllerChangePromise = new Promise(function controllerChangeWait(resolve, reject) {
                const timeoutIdentifier = setTimeout(function controllerChangeTimeout() {
                    //Failing a stalled activation without entering a reload loop.
                    cleanup();
                    reject(new LayerPwaError('PWA_UPDATE_TIMEOUT', 'The Service Worker update did not activate in time.', {
                        retryable: true
                    }));

                }, activationTimeoutMs);
                const controllerChangeHandle = function controllerChangeComplete() {
                    //Releasing the activation wait after the new controller takes ownership.
                    cleanup();
                    resolve(undefined);

                };
                const cleanup = function controllerChangeCleanup() {
                    //Removing timer and event listener for the winning path.
                    clearTimeout(timeoutIdentifier);
                    coordinatorOptions.serviceWorkerContainer.removeEventListener('controllerchange', controllerChangeHandle);

                };

                coordinatorOptions.serviceWorkerContainer.addEventListener('controllerchange', controllerChangeHandle, {
                    once: true
                });

            });

            checkedRegistration.waiting.postMessage({
                type: 'activate-update',
                appVersion: checkedManifest.appVersion
            });
            await controllerChangePromise;
            coordinatorOptions.reload();

        },

        bootStart() {
            //Incrementing a per-tab boot marker before migrations and hydration begin.
            const storageData = coordinatorOptions.sessionStorage;

            if (storageData === undefined) {
                return Object.freeze({
                    attempts: 1,
                    safeMode: false
                });

            }

            const currentAttempts = Number(storageData.getItem(bootMarkerKey) ?? 0);
            let nextAttempts = 1;

            if (Number.isSafeInteger(currentAttempts)) {
                nextAttempts = currentAttempts + 1;

            }
            storageData.setItem(bootMarkerKey, String(nextAttempts));

            return Object.freeze({
                attempts: nextAttempts,
                safeMode: nextAttempts > maximumBootAttempts
            });

        },

        bootSuccess() {
            //Clearing the loop marker only after application migration and hydration succeed.
            coordinatorOptions.sessionStorage?.removeItem(bootMarkerKey);

        }
    });

}
