const io = require('socket.io-client')
const jwt = require('jsonwebtoken')
const EventEmitter = require('events')
const gpio = require('rpi-gpio')
const defaultSettings = require('./settings.json')

const { DIR_HIGH, EDGE_RISING, MODE_BCM, EDGE_FALLING, DIR_LOW } = require('rpi-gpio')
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
        this._defaultSettings = Array.from(defaultSettings)
    }

    get _token() {
        return this._jwt.sign({ id: '', name: '' }, this._config.secret, {
            expiresIn: '365d',
        })
    }

    set distance(dist) {
        this._distance = dist// * this._distanceIncrement
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

        socket.on('serialport:open', (...arg) => {
            // This should contain logic to check the GRBL Settings.
            // It should read a txt file which contains the needed settings and compare them to the current settings
            // If the settings are different, it needs to overwrite the ones currently on the machine with the ones from the txt file
            // There is a python implementation in https://github.com/comakingspace/WorkBee
            // https://github.com/comakingspace/do-something/issues/45 Tracks the discussions around it
            // console.dir('open', arg)
            this._send(this._defaultSettings.pop() + '\n')
        })

        socket.on('serialport:error', (options) => {
            // console.dir('err', options)
        })

        socket.on('serialport:read', (data) => {
            // console.dir('read ', data)
        })

        socket.on('serialport:write', (data) => {
            if (this._defaultSettings.length > 0) {
                const setting = this._defaultSettings.pop()
                this._send(setting + '\n')
            }
            // console.dir('write', data)
        })

        socket.on('Grbl:state', (state) => {
            this.state = state
            // console.log('state', state)
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
        console.log('pressed: forward')
        this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    backward() {
        console.log('pressed: backward')
        this._send(`G91;\nY${this._distance};\nG90;\n`)
    }

    right() {
        console.log('pressed: right')
        this._send(`G91;\nX${this._distance};\nG90;\n`)
    }

    left() {
        console.log('pressed: left')
        this._send(`G91;\nX-${this._distance};\nG90;\n`)
    }

    up() {
        console.log('pressed: up')
        this._send(`G91;\nZ${this._distance};\nG90;\n`)
    }

    down() {
        console.log('pressed: down')
        this._send(`G91;\nZ-${this._distance};\nG90;\n`)
    }

    reset() {
        console.log('pressed: reset')
        //     this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    unlock() {
        console.log('pressed: unlock')
        this._send(`$X;\n`)
    }

    pause() {
        console.log('pressed: paused')
        //     this._send(`G91;\nY-${this._distance};\nG90;\n`)
    }

    zeroLeftRight() {
        console.log('pressed: zeroLeftRight')
        this._send(`G90;\nX0;\n`)
    }

    zeroForwardBack() {
        console.log('pressed: zeroForwardBack')
        this._send(`G90;\nY0;\n`)
    }

    zeroUpDown() {
        console.log('pressed: zeroUpDown')
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
        console.log(dist)
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
        Array.from(this._btns.keys()).forEach(btnID => {
            const currentButton = this._btns.get(btnID);
            this._gpio.setMode(MODE_BCM)
            this._gpio.setup(btnID, DIR_HIGH, currentButton.edge || EDGE_RISING, (err) => {
                if (err) {
                    this.emit('error', { ...err, btn: btnID })
                    return
                }

                if (currentButton.name == 'rotary') {
                    this._gpio.read(btnID, (e, value) => {
                        if (e) {
                            return;
                        }
                        if (!value) {
                            this.emit(currentButton.name, currentButton.parse(value))
                        }
                    })
                }
                this.emit('success', { id: btnID })
            })
        })


        this._gpio.on('change', (channel, value) => {
            const btn = this._btns.get(channel)
            console.log('buttons work', channel, value, btn)
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
    [9, { name: 'rotary', parse: () => 0.1, edge: EDGE_FALLING }],
    [11, { name: 'rotary', parse: () => 0.5, edge: EDGE_FALLING }],
    [5, { name: 'rotary', parse: () => 1, edge: EDGE_FALLING }],
    [6, { name: 'rotary', parse: () => 5, edge: EDGE_FALLING }],
    [19, { name: 'rotary', parse: () => 10, edge: EDGE_FALLING }],
    [26, { name: 'rotary', parse: () => 50, edge: EDGE_FALLING }],
])

const router = new CNCRouter()
const buttons = new Buttons(buttonMap)

buttons.on('error', (err) => {
    console.log('btns error', err)
    process.exit(1)
})

const buttonsToListen = new Set(Array.from(buttonMap.values()).map(({ name }) => name))

Array.from(buttonsToListen).forEach(btnName => buttons.on(btnName, router[btnName].bind(router)))
