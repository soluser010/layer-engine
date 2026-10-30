import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';


const requireData = createRequire( import.meta.url );
const mailPollIntervalData = Number( 1000 );
const mailLeaseDurationData = Number( 60000 );
const mailMaximumAttemptsData = Number( 5 );


/**
 * @param {string} templateNameData
 * @param {string} localeData
 * @param {Readonly<Record<string, unknown>>} payloadData
 * @returns {Readonly<{subject: string, text: string, html?: string}>}
 */
//Function for rendering bounded built-in security messages
const mailDefaultRender = function( templateNameData, localeData, payloadData ){
    const tokenData = payloadData.token;

    if ( typeof tokenData !== 'string' || Number( tokenData.length ) < Number( 20 ) || Number( tokenData.length ) > Number( 512 ) ){
        throw new TypeError( 'Layer Auth mail token is unavailable.' );

    }

    const russianLocaleStatusData = String( localeData ).toLowerCase().startsWith( 'ru' );

    if ( String( templateNameData ) === String( 'email-verification' ) ){
        let mailSubjectData = 'Verify your email address';
        let mailTextData = `Your Layer verification token: ${String( tokenData )}`;

        //Selecting the localized built-in verification copy without accepting arbitrary HTML
        if ( russianLocaleStatusData === true ){
            mailSubjectData = 'Подтверждение адреса электронной почты';
            mailTextData = `Код подтверждения Layer: ${String( tokenData )}`;

        }

        //CallBack THE OBJECT
        return Object.freeze({
            subject: mailSubjectData,
            text: mailTextData
        });

    }

    if ( String( templateNameData ) === String( 'password-recovery' ) ){
        let mailSubjectData = 'Reset your password';
        let mailTextData = `Your Layer password recovery token: ${String( tokenData )}`;

        //Selecting the localized built-in recovery copy without accepting arbitrary HTML
        if ( russianLocaleStatusData === true ){
            mailSubjectData = 'Восстановление пароля';
            mailTextData = `Код восстановления Layer: ${String( tokenData )}`;

        }

        //CallBack THE OBJECT
        return Object.freeze({
            subject: mailSubjectData,
            text: mailTextData
        });

    }

    throw new TypeError( 'Layer Auth mail template is not supported.' );

};

/**
 * Creates a multi-worker safe SMTP delivery loop over the durable outbox.
 *
 * @param {{
 *     repository: any,
 *     queue: any,
 *     smtp: Readonly<Record<string, any>>,
 *     password?: string,
 *     workerId?: string,
 *     clock?: () => number,
 *     transportCreate?: (optionsData: Record<string, unknown>) => any,
 *     render?: (templateNameData: string, localeData: string, payloadData: Readonly<Record<string, unknown>>) => Promise<{subject: string, text: string, html?: string}> | {subject: string, text: string, html?: string},
 *     diagnostics?: (diagnosticData: Readonly<Record<string, unknown>>) => void
 * }} deliveryOptions
 */
export function layerAuthMailDeliveryCreate( deliveryOptions ){
    //Checking the delivery boundaries without opening an SMTP connection
    if (
        deliveryOptions === null ||
        typeof deliveryOptions !== String( 'object' ) ||
        typeof deliveryOptions.repository?.lease !== String( 'function' ) ||
        typeof deliveryOptions.repository?.sent !== String( 'function' ) ||
        typeof deliveryOptions.repository?.failed !== String( 'function' ) ||
        typeof deliveryOptions.queue?.open !== String( 'function' ) ||
        deliveryOptions.smtp === null ||
        typeof deliveryOptions.smtp !== String( 'object' )
    ){
        throw new TypeError( 'Layer Auth mail delivery requires an outbox, queue, and SMTP configuration.' );

    }

    const clockData = deliveryOptions.clock ?? Date.now;
    const workerIdentifierData = deliveryOptions.workerId ?? `auth-mail-${String( randomUUID() )}`;
    const transportCreateData = deliveryOptions.transportCreate ?? function nodemailerTransportCreate( smtpOptionsData ){
        //Loading Nodemailer only when an enabled SMTP lifecycle creates transport
        const nodemailerData = /** @type {{createTransport: (optionsData: Record<string, unknown>) => any}} */ (requireData( 'nodemailer' ));

        return nodemailerData.createTransport( smtpOptionsData );

    };
    const renderData = deliveryOptions.render ?? mailDefaultRender;
    let transportData = /** @type {any} */ (null);
    let intervalData = /** @type {NodeJS.Timeout | null} */ (null);
    let runningStatusData = false;
    let stoppedStatusData = false;

    //Function for creating the SMTP transport only after runtime start
    const transportGetData = function(){
        if ( transportData === null ){
            const smtpOptionsData = /** @type {Record<string, unknown>} */ ({
                host: deliveryOptions.smtp.host,
                port: deliveryOptions.smtp.port,
                secure: deliveryOptions.smtp.secure,
                connectionTimeout: Number( 10000 ),
                greetingTimeout: Number( 10000 ),
                socketTimeout: Number( 30000 )
            });

            if ( deliveryOptions.smtp.username !== null ){
                smtpOptionsData.auth = {
                    user: deliveryOptions.smtp.username,
                    pass: deliveryOptions.password
                };

            }

            transportData = transportCreateData( smtpOptionsData );

        }

        //CallBack THE OBJECT
        return transportData;

    };

    //Function for delivering one leased batch without leaking message contents
    const batchRunData = async function(){
        if ( runningStatusData === true || stoppedStatusData === true ){
            return Object.freeze({processed: 0});

        }

        runningStatusData = true;
        let processedCountData = Number( 0 );

        try {
            const currentTimeData = Number( clockData() );
            const leasedMailData = await deliveryOptions.repository.lease({
                owner: workerIdentifierData,
                limit: Number( 10 ),
                leaseUntil: Number( currentTimeData ) + Number( mailLeaseDurationData )
            });

            for ( const mailData of leasedMailData ){
                try {
                    const openedMailData = deliveryOptions.queue.open( mailData );
                    const renderedMailData = /** @type {{subject: string, text: string, html?: string}} */ (await renderData(
                        mailData.templateName,
                        mailData.locale,
                        openedMailData.payload
                    ));

                    //Sending only the rendered bounded template through Nodemailer
                    const deliveryResultData = await transportGetData().sendMail({
                        from: deliveryOptions.smtp.from,
                        to: openedMailData.recipient,
                        subject: renderedMailData.subject,
                        text: renderedMailData.text,
                        html: renderedMailData.html
                    });

                    if ( Array.isArray( deliveryResultData?.rejected ) === true && Number( deliveryResultData.rejected.length ) > Number( 0 ) ){
                        throw new Error( 'SMTP_RECIPIENT_REJECTED' );

                    }

                    await deliveryOptions.repository.sent( mailData.mailId, workerIdentifierData );
                    processedCountData += Number( 1 );

                } catch( mailDeliveryErrorData ){
                    const terminalStatusData = Number( mailData.attempts ) >= Number( mailMaximumAttemptsData );
                    const retryDelayData = Math.min(
                        Number( 30000 ) * (Number( 2 ) ** Math.max( Number( 0 ), Number( mailData.attempts ) - Number( 1 ) )),
                        Number( 3600000 )
                    );

                    let deliveryErrorCodeData = 'SMTP_DELIVERY_RETRY';

                    //Marking the final bounded attempt as terminal for operator diagnostics
                    if ( terminalStatusData === true ){
                        deliveryErrorCodeData = 'SMTP_DELIVERY_EXHAUSTED';

                    }

                    await deliveryOptions.repository.failed({
                        mailId: mailData.mailId,
                        owner: workerIdentifierData,
                        errorCode: deliveryErrorCodeData,
                        nextAttemptAt: Number( clockData() ) + Number( retryDelayData ),
                        terminal: terminalStatusData
                    });
                    processedCountData += Number( 1 );

                    //Reporting only a safe operational code and identifier
                    deliveryOptions.diagnostics?.(Object.freeze({
                        code: deliveryErrorCodeData,
                        mailId: String( mailData.mailId ),
                        attempts: Number( mailData.attempts )
                    }));
                    void mailDeliveryErrorData;

                }

            }

            //CallBack THE OBJECT
            return Object.freeze({processed: Number( processedCountData )});

        } finally {
            runningStatusData = false;

        }

    };

    return Object.freeze({
        runOnce: batchRunData,

        async start(){
            //Keeping start idempotent for supervisor retry paths
            if ( intervalData !== null ){
                return;

            }

            stoppedStatusData = false;
            await batchRunData();
            intervalData = setInterval(function mailDeliveryPoll(){
                //Starting the next bounded batch without overlapping the active delivery loop
                void batchRunData();

            }, mailPollIntervalData );
            intervalData.unref();

        },

        async stop(){
            stoppedStatusData = true;

            if ( intervalData !== null ){
                clearInterval( intervalData );
                intervalData = null;

            }

            //Waiting for an active bounded batch before closing the transport
            while ( runningStatusData === true ){
                await new Promise(function mailDeliveryStopWait( resolveData ){
                    //Yielding briefly until the active delivery batch releases its lease
                    setTimeout( resolveData, Number( 10 ) );

                });

            }

            if ( transportData !== null && typeof transportData.close === String( 'function' ) ){
                transportData.close();

            }

            transportData = null;

        },

        isRunning(){
            //CallBack THE BOOLEAN
            return intervalData !== null && stoppedStatusData === false;

        }
    });

}
