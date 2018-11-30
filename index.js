const io = require('socket.io-client')
const jwt = require('jsonwebtoken')
const EventEmitter = require('events')
const gpio = require('rpi-gpio')
const { DIR_HIGH, EDGE_RISING } = require('rpi-gpio')
const fs = require('fs')

const offConfig = JSON.parse(fs.readFileSync('/home/pi/.cncrc'))

class CNCRouter {
    constructor(config = offConfig, _ioConnect = io, _jwt = jwt) {
        this._ioConnect = _ioConnect
        this._jwt = _jwt
        this._config = config
        this._connect()
        this._distance = 1
        this._distanceIncrement = 10
    }

    get _token() {
        return this._jwt.sign({ id: '', name: 'cncjs-pendant' }, this._config.secret, {
            expiresIn: '30d',
        })
    }

    set distance(dist) {
        this._distance = dist * this._distanceIncrement
    }

    async _connect() {
        const socket = this._ioConnect('http://localhost:8080', { query: { token: this._token } })
        this.socket = new Promise((resolve, reject) => {
            socket.on('connection', () => resolve(socket))
            socket.on('connect_error', err => reject(err))
        })
        socket.on('timeout', () => {
        })

        socket.on('reconnect', () => {
        })

        (await this.socket).emit('open', this._config.ports[0].comName, {
            baudrate: parseInt(this._config.baudrate),
            controllerType: this._config.controllerType,
        })
    }

    async _send(code) {
        (await this.socket).emit('write', this._config.ports[0].comName, code);
    }

    async forward() {
        await this._send(`G91/nY-${this._distance}/nG90/n`)
    }

    async backward() {
        await this._send(`G91/nY${this._distance}/nG90/n`)
    }

    async right() {
        await this._send(`G91/nX${this._distance}/nG90/n`)
    }

    async left() {
        await this._send(`G91/nX-${this._distance}/nG90/n`)
    }

    async up() {
        await this._send(`G91/nZ${this._distance}/nG90/n`)
    }

    async down() {
        await this._send(`G91/nZ-${this._distance}/nG90/n`)
    }

    async reset() {
        //     await this._send(`G91/nY-${this._distance}/nG90/n`)
    }

    async unlock() {
        //     await this._send(`G91/nY-${this._distance}/nG90/n`)
    }

    async pause() {
        //     await this._send(`G91/nY-${this._distance}/nG90/n`)
    }

    async zeroLeftRight() {
        await this._send(`G90/nX0/n`)
    }

    async zeroForwardBack() {
        await this._send(`G90/nY0/n`)
    }

    async zeroUpDown() {
        await this._send(`G90/nZ0/n`)
    }

    async home() {
        await this._send(`$H\n`)
    }

    rotary(dist) {
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
        this._btns.keys().forEach(btn => this._gpio.setup(btn, DIR_HIGH, EDGE_RISING, (err) => this.emit(err ? 'error' : 'success', err)))
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
    console.log(err)
})

Array.from(buttonMap.values()).forEach(btn => buttons.on(btn.name, router[btn.name].bind(router)))
