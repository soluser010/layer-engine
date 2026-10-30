import {lookup as dnsLookup} from 'node:dns/promises';
import {
    BlockList,
    isIP
} from 'node:net';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';

const blockedAddressList = new BlockList();

for (const subnetData of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
]) {
    blockedAddressList.addSubnet(/** @type {string} */ (subnetData[0]), /** @type {number} */ (subnetData[1]), 'ipv4');

}

for (const subnetData of [
    ['::', 128],
    ['::1', 128],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8]
]) {
    blockedAddressList.addSubnet(/** @type {string} */ (subnetData[0]), /** @type {number} */ (subnetData[1]), 'ipv6');

}

/**
 * @param {string} message
 */
function outboundRequestDeniedCreate(message) {
    //Returning one stable denial without DNS or network topology details.
    return new LayerError(
        LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED,
        message,
        {status: 400}
    );

}

/**
 * @param {string} addressData
 */
function publicAddressCheck(addressData) {
    const addressFamily = isIP(addressData);

    //Rejecting malformed resolver output before the block-list lookup.
    if (addressFamily === 0) {
        return false;

    }

    //Denying IPv4-mapped IPv6 forms so private IPv4 cannot bypass family rules.
    if (addressData.toLowerCase().startsWith('::ffff:')) {
        return false;

    }

    let familyName = /** @type {'ipv4' | 'ipv6'} */ ('ipv6');

    //Selecting the matching BlockList family explicitly.
    if (addressFamily === 4) {
        familyName = 'ipv4';

    }

    return !blockedAddressList.check(addressData, familyName);

}

/**
 * @param {object} policyOptions
 * @param {readonly string[]} policyOptions.allowedOrigins
 * @param {(hostname: string, options: {all: true, verbatim: true}) => Promise<readonly {address: string, family: number}[]>} [policyOptions.lookup]
 */
export function layerOutboundUrlPolicyCreate(policyOptions) {
    if (!Array.isArray(policyOptions.allowedOrigins) || policyOptions.allowedOrigins.length < 1 || policyOptions.allowedOrigins.length > 200) {
        throw new TypeError('Outbound URL allowlist is invalid.');

    }

    const allowedOriginSet = new Set();

    //Normalizing exact HTTPS origins once at startup.
    for (const originData of policyOptions.allowedOrigins) {
        let originUrl;

        try {
            originUrl = new URL(originData);

        } catch {
            throw new TypeError('Outbound URL allowlist contains an invalid origin.');

        }

        if (originUrl.protocol !== 'https:' || originUrl.origin !== originData || originUrl.username !== '' || originUrl.password !== '') {
            throw new TypeError('Outbound URL allowlist accepts exact HTTPS origins only.');

        }

        allowedOriginSet.add(originUrl.origin);

    }

    if (allowedOriginSet.size !== policyOptions.allowedOrigins.length) {
        throw new TypeError('Outbound URL allowlist contains duplicates.');

    }

    const lookup = policyOptions.lookup ?? dnsLookup;

    if (typeof lookup !== 'function') {
        throw new TypeError('Outbound URL resolver is invalid.');

    }

    return Object.freeze({
        /**
         * @param {string} requestUrl
         */
        async authorize(requestUrl) {
            if (typeof requestUrl !== 'string' || requestUrl.length < 1 || requestUrl.length > 2048) {
                throw outboundRequestDeniedCreate('The outbound URL is not allowed.');

            }

            let parsedUrl;

            try {
                parsedUrl = new URL(requestUrl);

            } catch {
                throw outboundRequestDeniedCreate('The outbound URL is not allowed.');

            }

            //Requiring exact allowlist membership and forbidding embedded credentials or fragments.
            if (parsedUrl.protocol !== 'https:' || !allowedOriginSet.has(parsedUrl.origin) || parsedUrl.username !== '' || parsedUrl.password !== '' || parsedUrl.hash !== '') {
                throw outboundRequestDeniedCreate('The outbound URL is not allowed.');

            }

            let resolvedAddresses;
            const literalAddressFamily = isIP(parsedUrl.hostname);

            if (literalAddressFamily === 0) {
                try {
                    //Resolving all addresses so a mixed public/private answer fails closed.
                    resolvedAddresses = await lookup(parsedUrl.hostname, {
                        all: true,
                        verbatim: true
                    });

                } catch {
                    throw outboundRequestDeniedCreate('The outbound destination could not be verified.');

                }

            } else {
                resolvedAddresses = [{
                    address: parsedUrl.hostname,
                    family: literalAddressFamily
                }];

            }

            if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length < 1 || resolvedAddresses.length > 32) {
                throw outboundRequestDeniedCreate('The outbound destination could not be verified.');

            }

            const publicAddresses = [];

            for (const resolvedAddress of resolvedAddresses) {
                if (typeof resolvedAddress !== 'object' || resolvedAddress === null || !publicAddressCheck(resolvedAddress.address)) {
                    throw outboundRequestDeniedCreate('The outbound destination is not public.');

                }

                publicAddresses.push(resolvedAddress.address);

            }

            return Object.freeze({
                url: parsedUrl.href,
                origin: parsedUrl.origin,
                hostname: parsedUrl.hostname,
                addresses: Object.freeze(publicAddresses)
            });

        }
    });

}
