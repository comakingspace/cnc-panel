const io = require('socket.io-client')
const jwt = require('jsonwebtoken')
const EventEmitter = require('events')
const gpio = require('rpi-gpio')
const { DIR_HIGH, EDGE_RISING, MODE_BCM } = require('rpi-gpio')
const fs = require('fs')

const offConfig = JSON.parse(fs.readFileSync('/home/pi/.cncrc'))

class CNCRouter {
    constructor(config = offConfig, _ioConnect = io.connect, _jwt = jwt) {
        this._ioConnect = _ioConnect
        this._jwt = _jwt
        this._config = config
        this._connect()
        this._distance = 1
        this._distanceIncrement = 10
        this._state = {}
    }

    get _token() {
        return this._jwt.sign({ id: '', name: '' }, this._config.secret, {
            expiresIn: '30d',
        })
    }

    set distance(dist) {
        this._distance = dist * this._distanceIncrement
    }

    async _connect() {
        const socket = this._ioConnect('http://localhost:8080', { query: { token: this._token } })
        this.socket = socket
        socket.on('connection', (_socket) => console.log('socket connected'))
        socket.on('connect_error', err => console.error('error socket', err))

        socket.on('error', (err) => {
            console.error('Connection error.', err);
        })

        socket.emit('open', this._config.ports[0].comName, {
            baudrate: parseInt(this._config.baudrate),
            controllerType: this._config.controllerType,
        })

        socket.on('serialport:open', (options) => {
            // This should contain logic to check the GRBL Settings.
            // It should read a txt file which contains the needed settings and compare them to the current settings
            // If the settings are different, it needs to overwrite the ones currently on the machine with the ones from the txt file
            // There is a python implementation in https://github.com/comakingspace/WorkBee
            // https://github.com/comakingspace/do-something/issues/45 Tracks the discussions around it
        })

        socket.on('serialport:error', (options) => {
        })

        socket.on('serialport:read', (data) => {
        })

        socket.on('serialport:write', (data) => {
        })

        socket.on('Grbl:state', (state) => {
            this.state = state
            // We should check, what information is available here
            // If this contains information about the remaining time of the job, this should be published on mqtt. Topic: /CNC/Status
        })

        socket.on('Grbl:settings', (settings) => {
        })

        socket.on('task:start', (settings) => {
            // This should post on MQTT on topic /CNC/Status
        })

        socket.on('task:finish', (settings) => {
            // This should post on MQTT on topic /CNC/Status
        })

        socket.on('task:error', (settings) => {
            // This should post on MQTT on topic /CNC/Status
        })
    }

    _send(code) {
        this.socket.emit('write', this._config.ports[0].comName, code);
    }

    forward() {
        this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    backward() {
        this._send(`G91;\nY${this._distance};\nG90;\n`)
    }

    right() {
        this._send(`G91;\nX${this._distance};\nG90;\n`)
    }

    left() {
        this._send(`G91;\nX-${this._distance};\nG90;\n`)
    }

    up() {
        this._send(`G91;\nZ${this._distance};\nG90;\n`)
    }

    down() {
        this._send(`G91;\nZ-${this._distance};\nG90;\n`)
    }

    reset() {
        //     this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    unlock() {
        this._send(`$X;\n`)
    }

    pause() {
        //     this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    zeroLeftRight() {
        this._send(`G90;\nX0;\n`)
    }

    zeroForwardBack() {
        this._send(`G90;\nY0;\n`)
    }

    zeroUpDown() {
        this._send(`G90;\nZ0;\n`)
    }

    home() {
        this._send(`$H\n`)
    }

    rotary(dist) {
        // buttonMap should be changed to lead to the following values (https://github.com/comakingspace/do-something/issues/67#issuecomment-425753577)
        // 0.1mm
        // 1mm
        // 10mm
        // 50mm
        // 100mm
        // 200mm
        // Do we need some initialization to find the correct value during boot?
        this.distance = dist
    }
}

class Buttons extends EventEmitter {
    constructor(btns = new Map(), _gpio = gpio) {
        super()
        this._btns = btns
        this._gpio = _gpio
        this._setup()
    }

    async _setup() {
        Array.from(this._btns.keys()).forEach(btn => this._gpio.setup(btn, DIR_HIGH, EDGE_RISING, (err) => this.emit(err ? 'error' : 'success', {
            ...err,
            btn,
        } || btn)))
        this._gpio.setMode(MODE_BCM)
        this._gpio.on('change', (channel, value) => {
            console.log('buttons work', channel, value)
            const btn = this._btns.get(channel)
            this.emit(btn.name, btn.parse(value))
        })
    }
}

const buttonMap = new Map([
    [25, { name: 'left', parse: (value) => !!value }],
    [24, { name: 'right', parse: (value) => !!value }],
    [23, { name: 'forward', parse: (value) => !!value }],
    [18, { name: 'backward', parse: (value) => !!value }],
    [8, { name: 'up', parse: (value) => !!value }],
    [7, { name: 'down', parse: (value) => !!value }],
    [16, { name: 'reset', parse: (value) => !!value }],
    [20, { name: 'unlock', parse: (value) => !!value }],
    [21, { name: 'home', parse: (value) => !!value }],
    [4, { name: 'pause', parse: (value) => !!value }],
    [27, { name: 'zeroLeftRight', parse: (value) => !!value }],
    [22, { name: 'zeroForwardBack', parse: (value) => !!value }],
    [10, { name: 'zeroUpDown', parse: (value) => !!value }],
    [9, { name: 'rotary', parse: () => 1 }],
    [11, { name: 'rotary', parse: () => 2 }],
    [5, { name: 'rotary', parse: () => 3 }],
    [6, { name: 'rotary', parse: () => 4 }],
    [19, { name: 'rotary', parse: () => 5 }],
    [26, { name: 'rotary', parse: () => 6 }],
])

const router = new CNCRouter()
const buttons = new Buttons(buttonMap)

buttons.on('error', (err) => {
    console.log('btns error', err)
})

Array.from(buttonMap.values()).forEach(btn => buttons.on(btn.name, router[btn.name].bind(router)))
