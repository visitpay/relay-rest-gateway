const relay = require('librelay');
const client = require('prom-client');
const histogramMessage = new client.Histogram({
  name: 'IncomingV1_Message',
  help: 'This is how many messages are coming in over time.'
});
const histogramError = new client.Histogram({
    name: 'IncomingV1_Error',
    help: 'This is how many errors over time'
});
const gaugeIncomingConnections = new client.Gauge({ name: 'IncomingV1_Connection', help: 'Incomming connection count' });
const gaugeIncomingDisconnect = new client.Gauge({ name: 'IncomingV1_SignalDisconnect', help: 'Incomming signal disconnects' });
const gaugeSocketReadyState = new client.Gauge({ name: 'IncomingV1_Socket_ReadyState', help: 'Incomming connection count' });

const gaugeExpressConnections = new client.Gauge({ name: 'ExpressWS_Connection', help: 'Incomming connection count from ChatGateway' });


class OutgoingV1 {
    async create(data, params) {
        const sender = await relay.MessageSender.factory();
        return await sender.send(data);
    }
}

class IncomingV1 {

    constructor(ws) {
        this.clients = new Set();
    }

    publish(event, data) {
        if (!this.clients.size) {
            console.warn(`Ignoring ${event} event.  No clients are connected.`);
            return;
        }
        const payload = JSON.stringify({event, data});
        console.info(`Publishing ${event} event to ${this.clients.size} client(s).`);
        for (const ws of this.clients) {
            ws.send(payload);
        }
    }

    onNeedConnectionmetrics(){
        //Should I ever:  ???
        //clearTimeout(this.metricsTimer);
        if (this.reciever ) {
            try {
                console.log("onNeedConnectionmetrics - socket: ", this.reciever.wsr.socket.readyState);
                gaugeSocketReadyState.set(this.reciever.wsr.socket.readyState);
            }
            catch (e) {
                console.warn("onNeedConnectionmetrics - entering catch block");
                console.warn(e);
                gaugeSocketReadyState.set(0);
            }
        }
    }
    async onConnection(ws, req) {
        this.clients.add(ws);
        gaugeExpressConnections.inc();
        if (!this.reciever) {
            this.reciever = await relay.MessageReceiver.factory();
            this.reciever.addEventListener('keychange', this.onKeyChange.bind(this));
            this.reciever.addEventListener('message', this.onMessage.bind(this));
            this.reciever.addEventListener('receipt', this.onReceipt.bind(this));
            this.reciever.addEventListener('sent', this.onSent.bind(this));
            this.reciever.addEventListener('read', this.onRead.bind(this));
            this.reciever.addEventListener('closingsession', this.onClosingSession.bind(this));
            this.reciever.addEventListener('close', this.onClosingSession.bind(this));
            this.reciever.addEventListener('error', this.onError.bind(this));
            console.log('Registering for open event from socket');
            this.reciever.wsr.addEventListener('open', function open() {
                //pretty sure i'll never get this.
                //librelay-node\src\websocket_resource.js:158 
                //Has an await, doesnt register event that this could get till later
                gaugeIncomingConnections.set(1);
                console.log('Socket (reciever.wsr) opened');
            });
            await this.reciever.connect();
            console.log('Registering for close event from socket');
            this.reciever.wsr.addEventListener('close', function close() {
                gaugeIncomingConnections.set(0);
                gaugeIncomingDisconnect.inc();
                console.log('Socket (reciever.wsr) disconnected');
            });
            this.metricsTimer = setInterval(this.onNeedConnectionmetrics.bind(this), 30000);
            console.log("onConnection - socket: ", this.reciever.wsr)
        }
        console.info("Client connected:", req.ip);
        ws.on('close', () => {
            gaugeExpressConnections.dec();
            console.warn("Client disconnected: ", req.ip);
            this.clients.delete(ws);
        });
    }

    async onKeyChange(ev) {
        console.warn("onKeyChange: ", ev);
        // XXX TBD  Probably just autoaccept for now.
        //debugger;
        console.error("`keychange` event not handled");
    }

    async onMessage(ev) {
        console.warn("onMessage ENTER: ", ev);
        try {
            for (const x of ev.data.message.attachments) {
                x.data = await this.reciever.fetchAttachment(x);
            }
            this.publish('message', {
                expirationStartTimestamp: ev.data.expirationStartTimestamp,
                body: JSON.parse(ev.data.message.body),
                attachments: ev.data.message.attachments,
                source: ev.data.source,
                sourceDevice: ev.data.sourceDevice,
                timestamp: ev.data.timestamp,
            });
            histogramMessage.observe(1);
        }
        catch (e) {
            console.warn("onMessage - entering catch block");
            console.warn(e);
            console.warn("onMessage - leaving catch block - rethrowing");
            throw( error );
        }
        finally {
            console.warn("onMessage EXIT")
        }
        
    }

    async onReceipt(ev) {
        console.warn("onReceipt: ", ev);
        this.publish('receipt', {
            source: ev.proto.source,
            sourceDevice: ev.proto.sourceDevice,
            timestamp: ev.proto.timestamp,
        });
    }

    async onSent(ev) {
        for (const x of ev.data.message.attachments) {
            x.data = await this.reciever.fetchAttachment(x);
        }
        this.publish('sent', {
            destination: ev.data.destination,
            expirationStartTimestamp: ev.data.expirationStartTimestamp,
            body: JSON.parse(ev.data.message.body),
            attachments: ev.data.message.attachments,
            source: ev.data.source,
            sourceDevice: ev.data.sourceDevice,
            timestamp: ev.data.timestamp,
        });
    }

    async onRead(ev) {
        console.warn("onRead: ", ev);
        this.publish('read', {
            sender: ev.read.sender,
            source: ev.read.source,
            sourceDevice: ev.read.sourceDevice,
            readTimestamp: ev.read.timestamp,
            timestamp: ev.timestamp,
        });
    }

    async onClosingSession(ev) {
        console.warn("onClosingSession: ", ev);

        // XXX TBD
        //debugger;
        console.error("`closingsession` event not handled");
    }

    onError(ev) {
        console.warn("onError: ", ev);
        histogramError.observe(1);
        this.publish('error', {ev});
    }
}


module.exports = {
    OutgoingV1,
    IncomingV1
};
