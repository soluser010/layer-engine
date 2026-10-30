import {
    BlockList,
    isIP
} from 'node:net';

const trustedProxyFields = Object.freeze([
    'addresses',
    'header',
    'maximumHops'
]);

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck(valueData) {
    //Checking proxy configuration records without accepting arrays or custom scalar values.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {string} addressData
 */
function ipAddressNormalize(addressData) {
    //Removing transport notation before validating one canonical client address.
    let normalizedAddress = addressData.trim();

    if (normalizedAddress.startsWith('[')) {
        const closingBracketIndex = normalizedAddress.indexOf(']');

        if (closingBracketIndex < 2 || !/^(?::\d{1,5})?$/.test(normalizedAddress.slice(closingBracketIndex + 1))) {
            return null;

        }

        normalizedAddress = normalizedAddress.slice(1, closingBracketIndex);

    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(normalizedAddress)) {
        normalizedAddress = normalizedAddress.slice(0, normalizedAddress.lastIndexOf(':'));

    }

    const zoneIndex = normalizedAddress.indexOf('%');

    if (zoneIndex > 0) {
        normalizedAddress = normalizedAddress.slice(0, zoneIndex);

    }

    const mappedIpv4Match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalizedAddress);

    if (mappedIpv4Match !== null) {
        normalizedAddress = String(mappedIpv4Match[1]);

    }

    if (isIP(normalizedAddress) === 0) {
        return null;

    }

    return normalizedAddress.toLowerCase();

}

/**
 * @param {string} addressData
 * @returns {'ipv4' | 'ipv6'}
 */
function blockListFamilyGet(addressData) {
    if (isIP(addressData) === 4) {
        //Selecting the Node BlockList label for a validated IPv4 address.
        return 'ipv4';

    } else {
        //Treating the remaining validated address family as IPv6.
        return 'ipv6';

    }

}

/**
 * @param {unknown} trustedProxyInput
 */
export function layerTrustedProxyCreate(trustedProxyInput) {
    if (trustedProxyInput === undefined || trustedProxyInput === null) {
        return null;

    }

    if (!plainObjectCheck(trustedProxyInput)) {
        throw new TypeError('trustedProxy must be null or an object.');

    }

    const trustedProxyData = /** @type {Record<string, unknown>} */ (trustedProxyInput);
    const unknownFields = Object.keys(trustedProxyData).filter(function trustedProxyFieldUnknown(fieldName) {
        //Rejecting misspelled security fields instead of silently weakening proxy trust.
        return !trustedProxyFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        throw new TypeError('trustedProxy contains unknown fields.');

    }

    const addressInput = trustedProxyData.addresses;
    const headerData = trustedProxyData.header ?? 'x-forwarded-for';
    const maximumHopsData = trustedProxyData.maximumHops ?? 8;

    if (!Array.isArray(addressInput) || addressInput.length < 1 || addressInput.length > 64 ||
        !['forwarded', 'x-forwarded-for'].includes(String(headerData)) ||
        !Number.isInteger(maximumHopsData) || Number(maximumHopsData) < 1 || Number(maximumHopsData) > 32) {
        throw new TypeError('trustedProxy requires bounded addresses, header, and maximumHops.');

    }

    const addressList = new BlockList();
    const normalizedAddresses = [];

    for (const addressValue of addressInput) {
        if (typeof addressValue !== 'string' || addressValue.length < 1 || addressValue.length > 100) {
            throw new TypeError('trustedProxy addresses must be IP addresses or CIDR blocks.');

        }

        if (addressValue === 'loopback') {
            //Expanding the explicit convenience token to both loopback address families.
            addressList.addSubnet('127.0.0.0', 8, 'ipv4');
            addressList.addAddress('::1', 'ipv6');
            normalizedAddresses.push('loopback');

            continue;

        }

        const subnetMatch = /^(.+)\/(\d{1,3})$/.exec(addressValue);

        if (subnetMatch !== null) {
            const subnetAddress = ipAddressNormalize(String(subnetMatch[1]));
            /** @type {number} */
            let subnetFamily;

            if (subnetAddress === null) {
                //Keeping an invalid family marker for the shared CIDR rejection path.
                subnetFamily = 0;

            } else {
                //Reading the address family only after canonical IP validation.
                subnetFamily = isIP(subnetAddress);

            }

            const subnetPrefix = Number(subnetMatch[2]);
            /** @type {number} */
            let maximumPrefix;

            if (subnetFamily === 4) {
                //Applying the bounded IPv4 prefix width.
                maximumPrefix = 32;

            } else {
                //Applying the bounded IPv6 prefix width.
                maximumPrefix = 128;

            }

            if (subnetAddress === null || subnetPrefix < 0 || subnetPrefix > maximumPrefix) {
                throw new TypeError('trustedProxy contains an invalid CIDR block.');

            }

            addressList.addSubnet(subnetAddress, subnetPrefix, blockListFamilyGet(subnetAddress));
            normalizedAddresses.push(`${subnetAddress}/${subnetPrefix}`);

            continue;

        }

        const exactAddress = ipAddressNormalize(addressValue);

        if (exactAddress === null) {
            throw new TypeError('trustedProxy contains an invalid IP address.');

        }

        addressList.addAddress(exactAddress, blockListFamilyGet(exactAddress));
        normalizedAddresses.push(exactAddress);

    }

    return Object.freeze({
        addresses: Object.freeze(normalizedAddresses),
        header: /** @type {'forwarded' | 'x-forwarded-for'} */ (headerData),
        maximumHops: Number(maximumHopsData),
        addressCheck(/** @type {string} */ addressData) {
            //Normalizing every lookup before consulting the immutable trusted range list.
            const normalizedAddress = ipAddressNormalize(addressData);

            if (normalizedAddress === null) {
                return false;

            }

            return addressList.check(normalizedAddress, blockListFamilyGet(normalizedAddress));

        }
    });

}

/**
 * @param {string | string[] | undefined} headerValue
 * @param {'forwarded' | 'x-forwarded-for'} headerName
 * @param {number} maximumHops
 */
function forwardedAddressesRead(headerValue, headerName, maximumHops) {
    if (typeof headerValue !== 'string' || headerValue.length < 1 || headerValue.length > 4096) {
        return null;

    }

    const forwardedParts = headerValue.split(',');

    if (forwardedParts.length > maximumHops) {
        return null;

    }

    const forwardedAddresses = [];

    for (const forwardedPart of forwardedParts) {
        let addressValue = forwardedPart.trim();

        if (headerName === 'forwarded') {
            const forwardedParameter = forwardedPart.split(';').find(function forwardedForFind(parameterData) {
                //Selecting the standard for parameter without accepting similarly named fields.
                return /^\s*for=/i.test(parameterData);

            });

            if (forwardedParameter === undefined) {
                return null;

            }

            addressValue = forwardedParameter.replace(/^\s*for=/i, '').trim();

            if (addressValue.startsWith('"') && addressValue.endsWith('"')) {
                addressValue = addressValue.slice(1, -1);

            }

        }

        const normalizedAddress = ipAddressNormalize(addressValue);

        if (normalizedAddress === null) {
            return null;

        }

        forwardedAddresses.push(normalizedAddress);

    }

    return forwardedAddresses;

}

/**
 * @param {import('node:http').IncomingMessage} requestData
 * @param {ReturnType<typeof layerTrustedProxyCreate>} trustedProxyData
 */
export function layerClientAddressResolve(requestData, trustedProxyData) {
    const socketAddress = ipAddressNormalize(requestData.socket.remoteAddress ?? '');

    if (socketAddress === null) {
        return 'unknown';

    }

    if (trustedProxyData === null || trustedProxyData.addressCheck(socketAddress) === false) {
        //Ignoring all forwarded headers unless the immediate peer is explicitly trusted.
        return socketAddress;

    }

    const forwardedAddresses = forwardedAddressesRead(
        requestData.headers[trustedProxyData.header],
        trustedProxyData.header,
        trustedProxyData.maximumHops
    );

    if (forwardedAddresses === null || forwardedAddresses.length === 0) {
        return socketAddress;

    }

    const addressChain = [
        ...forwardedAddresses,
        socketAddress
    ];

    for (let addressIndex = addressChain.length - 1; addressIndex >= 0; addressIndex -= 1) {
        const currentAddress = String(addressChain[addressIndex]);

        if (trustedProxyData.addressCheck(currentAddress)) {
            continue;

        }

        //Returning the nearest untrusted hop prevents a client-supplied left prefix from spoofing identity.
        return currentAddress;

    }

    return String(addressChain[0]);

}
