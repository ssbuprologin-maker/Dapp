"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
var redis_1 = require("@upstash/redis");
var web3_js_1 = require("@solana/web3.js");
var CHAT_HISTORY_KEY = 'testnet-games:chat-history:v1';
function redisClient() {
    var _a, _b;
    var url = (_a = process.env.UPSTASH_REDIS_REST_URL) === null || _a === void 0 ? void 0 : _a.trim();
    var token = (_b = process.env.UPSTASH_REDIS_REST_TOKEN) === null || _b === void 0 ? void 0 : _b.trim();
    if (!url || !token)
        throw new Error('Chat history is not configured.');
    return new redis_1.Redis({ url: url, token: token });
}
function parseRecord(value) {
    if (!value || typeof value !== 'object')
        return null;
    var record = value;
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.message !== 'string' || typeof record.sentAt !== 'number' || (record.network !== 'solana' && record.network !== 'megaeth') || typeof record.wallet !== 'string')
        return null;
    try {
        if (record.network === 'solana')
            new web3_js_1.PublicKey(record.wallet);
        else if (!/^0x[a-fA-F0-9]{40}$/.test(record.wallet))
            return null;
    }
    catch (_a) {
        return null;
    }
    var reply = record.replyTo;
    var replyTo = reply && typeof reply.id === 'string' && typeof reply.name === 'string' && typeof reply.message === 'string'
        ? { id: reply.id.slice(0, 100), name: reply.name.slice(0, 40), message: reply.message.slice(0, 100) }
        : undefined;
    return { id: record.id.slice(0, 120), name: record.name.slice(0, 40), message: record.message.slice(0, 140), network: record.network, wallet: record.wallet, sentAt: record.sentAt, replyTo: replyTo };
}
function handler(request, response) {
    return __awaiter(this, void 0, void 0, function () {
        var redis, rows, messages, record, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    response.setHeader('Cache-Control', 'no-store');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    redis = redisClient();
                    if (!(request.method === 'GET')) return [3 /*break*/, 3];
                    return [4 /*yield*/, redis.lrange(CHAT_HISTORY_KEY, 0, 29)];
                case 2:
                    rows = _a.sent();
                    messages = rows.map(function (row) { try {
                        return parseRecord(JSON.parse(row));
                    }
                    catch (_a) {
                        return null;
                    } }).filter(function (item) { return Boolean(item); }).sort(function (a, b) { return a.sentAt - b.sentAt; });
                    return [2 /*return*/, response.status(200).json({ messages: messages })];
                case 3:
                    if (request.method !== 'POST')
                        return [2 /*return*/, response.status(405).json({ message: 'Method not allowed.' })];
                    record = parseRecord(request.body);
                    if (!record)
                        throw new Error('Invalid chat message.');
                    return [4 /*yield*/, redis.lpush(CHAT_HISTORY_KEY, JSON.stringify(record))
                        // Trim only after inserting message 31. Therefore a smaller chat is never deleted.
                    ];
                case 4:
                    _a.sent();
                    // Trim only after inserting message 31. Therefore a smaller chat is never deleted.
                    return [4 /*yield*/, redis.ltrim(CHAT_HISTORY_KEY, 0, 29)];
                case 5:
                    // Trim only after inserting message 31. Therefore a smaller chat is never deleted.
                    _a.sent();
                    return [2 /*return*/, response.status(200).json({ ok: true })];
                case 6:
                    error_1 = _a.sent();
                    return [2 /*return*/, response.status(400).json({ message: error_1 instanceof Error ? error_1.message : 'Chat history request failed.' })];
                case 7: return [2 /*return*/];
            }
        });
    });
}
