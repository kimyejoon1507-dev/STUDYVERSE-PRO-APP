import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookie from 'cookie';
import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import initSqlJs, { type Database } from 'sql.js';
import { Server } from 'socket.io';
import { z } from 'zod';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const port = Number(process.env.PORT ?? 3001);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('replace-this')) {
  throw new Error('JWT_SECRET must be set in .env to a random secret of at least 32 characters.');
}

const databaseFile = path.resolve(process.cwd(), process.env.DB_FILE ?? './data/studyverse.sqlite');
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js')), file) });
const db: Database = fs.existsSync(databaseFile)
  ? new SQL.Database(fs.readFileSync(databaseFile))
  : new SQL.Database();
db.run('PRAGMA foreign_keys = ON');
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, nickname TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '',
    coins INTEGER NOT NULL DEFAULT 100, xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id),
    receiver_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, UNIQUE(sender_id, receiver_id)
  );
  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL REFERENCES users(id), user_b TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, PRIMARY KEY(user_a, user_b)
  );
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, PRIMARY KEY(blocker_id, blocked_id)
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id),
    reported_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    direct_key TEXT UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    minutes INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_plans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    title TEXT NOT NULL, planned_date TEXT NOT NULL, target_minutes INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    title TEXT NOT NULL, exam_date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_results (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    score INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_mistakes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    question TEXT NOT NULL, correct_answer TEXT NOT NULL, submitted_answer TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory (
    user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1, equipped INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS purchase_history (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL,
    price INTEGER NOT NULL, purchased_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    started_at TEXT NOT NULL, finished_at TEXT, score INTEGER, reward_coins INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_missions (
    user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, mission_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL, PRIMARY KEY(user_id, day, mission_id)
  );
`);
db.run('CREATE INDEX IF NOT EXISTS study_user_date ON study_sessions(user_id, created_at)');
db.run('CREATE INDEX IF NOT EXISTS plan_user_date ON study_plans(user_id, planned_date)');
db.run('CREATE INDEX IF NOT EXISTS messages_conversation_date ON messages(conversation_id, created_at)');

function persist() {
  fs.writeFileSync(databaseFile, Buffer.from(db.export()));
}
function rows<T>(sql: string, values: unknown[] = []): T[] {
  const statement = db.prepare(sql);
  statement.bind(values as (string | number | null | Uint8Array)[]);
  const result: T[] = [];
  while (statement.step()) result.push(statement.getAsObject() as T);
  statement.free();
  return result;
}
function row<T>(sql: string, values: unknown[] = []): T | undefined {
  return rows<T>(sql, values)[0];
}
function run(sql: string, values: unknown[] = []) {
  db.run(sql, values as (string | number | null | Uint8Array)[]);
}
function transaction<T>(action: () => T): T {
  db.run('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.run('COMMIT');
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
function now() {
  return new Date().toISOString();
}
function createId() {
  return crypto.randomUUID();
}
function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value;
}
function userView(user: { id: string; user_id: string; email: string; nickname: string; avatar: string; coins: number; xp: number; level: number }) {
  return {
    id: user.id, userId: user.user_id, email: user.email, nickname: user.nickname,
    avatar: user.avatar, coins: user.coins, xp: user.xp, level: user.level
  };
}
type SessionRequest = Request & { userId?: string; cookies?: Record<string, string> };
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
const cookieOptions = {
  httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production',
  path: '/', maxAge: 7 * 24 * 60 * 60 * 1000
};
function issueCookie(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, jwtSecret!, { expiresIn: '7d' });
  res.cookie('studyverse_session', token, cookieOptions);
}
function authenticate(req: SessionRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.studyverse_session;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(token, jwtSecret!) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') throw new Error('Invalid session');
    req.userId = payload.sub;
    next();
  } catch {
    res.clearCookie('studyverse_session', { path: '/' });
    return res.status(401).json({ error: '로그인 정보가 만료되었습니다.' });
  }
}
app.use((req, _res, next) => {
  const parsed = cookie.parse(req.headers.cookie ?? '');
  (req as SessionRequest & { cookies?: Record<string, string> }).cookies = parsed;
  next();
});
const auth = authenticate;
const subjects = ['국어', '영어', '수학', '과학', '사회'];
const onlineUsers = new Set<string>();
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function limitAuthAttempts(req: Request, res: Response, next: NextFunction) {
  const key = `${req.ip}:${req.path}`;
  res.once('finish', () => { if (res.statusCode < 400) authAttempts.delete(key); });
  const timestamp = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= timestamp) {
    authAttempts.set(key, { count: 1, resetAt: timestamp + 15 * 60 * 1000 });
    return next();
  }
  if (current.count >= 10) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
  current.count += 1;
  next();
}
const registrationSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  nickname: z.string().trim().min(2).max(24)
});
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
function friendPair(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}
function areFriends(a: string, b: string) {
  const [first, second] = friendPair(a, b);
  return Boolean(row('SELECT 1 AS yes FROM friendships WHERE user_a = ? AND user_b = ?', [first, second]));
}
function isBlocked(a: string, b: string) {
  return Boolean(row('SELECT 1 AS yes FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', [a, b, b, a]));
}
function isMember(conversationId: string, userId: string) {
  return Boolean(row('SELECT 1 AS yes FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, userId]));
}
function canAccessConversation(conversationId: string, userId: string) {
  if (!isMember(conversationId, userId)) return false;
  const conversation = row<{ kind: string; direct_key: string | null }>('SELECT kind, direct_key FROM conversations WHERE id = ?', [conversationId]);
  if (!conversation) return false;
  if (conversation.kind !== 'direct' || !conversation.direct_key) return true;
  const [a, b] = conversation.direct_key.split(':');
  return !isBlocked(a, b);
}
function blockedDirectKey(directKey: string) {
  const [a, b] = directKey.split(':');
  return Boolean(a && b && isBlocked(a, b));
}
function rewardStudy(userId: string, minutes: number, date: string) {
  const total = row<{ total: number }>('SELECT COALESCE(SUM(minutes), 0) AS total FROM study_sessions WHERE user_id = ? AND substr(created_at, 1, 10) = ?', [userId, date])?.total ?? 0;
  const before = Math.max(0, total - minutes);
  const earnedBefore = Math.min(80, Math.floor(before / 10) * 2);
  const earnedNow = Math.min(80, Math.floor(total / 10) * 2);
  const delta = Math.max(0, earnedNow - earnedBefore);
  if (delta) addXp(userId, delta);
}
function addXp(userId: string, amount: number) {
  run('UPDATE users SET xp = xp + ?, level = CAST((xp + ?) / 100 AS INTEGER) + 1 WHERE id = ?', [amount, amount, userId]);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: 'sqlite' }));
app.post('/api/auth/register', limitAuthAttempts, async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '이메일, 닉네임 또는 비밀번호를 확인해 주세요.' });
  const { email, password, nickname } = parsed.data;
  if (row('SELECT 1 FROM users WHERE lower(email) = lower(?)', [email])) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  const id = createId();
  const userId = `SV${crypto.randomInt(10000000, 100000000)}`;
  const passwordHash = await bcrypt.hash(password, 12);
  run('INSERT INTO users (id, user_id, email, password_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, userId, email.toLowerCase(), passwordHash, nickname, now()]);
  persist();
  issueCookie(res, id);
  res.status(201).json({ user: userView(row('SELECT * FROM users WHERE id = ?', [id])!) });
});
app.post('/api/auth/login', limitAuthAttempts, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '이메일 또는 비밀번호를 확인해 주세요.' });
  const user = row<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE lower(email) = lower(?)', [parsed.data.email]);
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  issueCookie(res, user.id);
  res.json({ user: userView(row('SELECT * FROM users WHERE id = ?', [user.id])!) });
});
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('studyverse_session', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/auth/me', (req: SessionRequest, res) => {
  const token = req.cookies?.studyverse_session;
  if (!token) return res.json({ user: null });
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, jwtSecret!) as jwt.JwtPayload;
  } catch {
    res.clearCookie('studyverse_session', { path: '/' });
    return res.json({ user: null });
  }
  if (typeof payload.sub !== 'string') {
    res.clearCookie('studyverse_session', { path: '/' });
    return res.json({ user: null });
  }
  const user = row('SELECT id, user_id, email, nickname, avatar, coins, xp, level FROM users WHERE id = ?', [payload.sub]);
  if (!user) return res.json({ user: null });
  res.json({ user: userView(user as Parameters<typeof userView>[0]) });
});
app.patch('/api/profile', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ nickname: z.string().trim().min(2).max(24), avatar: z.union([z.literal(''), z.string().url().max(500)]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '닉네임 또는 프로필 이미지 주소를 확인해 주세요.' });
  if (parsed.data.avatar) {
    try {
      if (new URL(parsed.data.avatar).protocol !== 'https:') return res.status(400).json({ error: '프로필 이미지 주소는 HTTPS만 사용할 수 있습니다.' });
    } catch {
      return res.status(400).json({ error: '프로필 이미지 주소를 확인해 주세요.' });
    }
  }
  run('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?', [parsed.data.nickname, parsed.data.avatar ?? '', req.userId]);
  persist();
  res.json({ user: userView(row('SELECT * FROM users WHERE id = ?', [req.userId])!) });
});

app.get('/api/dashboard', auth, (req: SessionRequest, res) => {
  const userId = req.userId!;
  const user = row('SELECT id, user_id, email, nickname, avatar, coins, xp, level FROM users WHERE id = ?', [userId])!;
  const study = rows<{ subject: string; minutes: number; created_at: string }>('SELECT subject, minutes, created_at FROM study_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  const quizzes = rows<{ subject: string; score: number; total: number }>('SELECT subject, score, total FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  const exams = rows('SELECT id, subject, title, exam_date AS date FROM exams WHERE user_id = ? AND exam_date >= ? ORDER BY exam_date LIMIT 10', [userId, new Date().toISOString().slice(0, 10)]);
  const studyMinutes = row<{ total: number }>('SELECT COALESCE(SUM(minutes), 0) AS total FROM study_sessions WHERE user_id = ?', [userId])?.total ?? 0;
  const quizCount = row<{ total: number }>('SELECT COUNT(*) AS total FROM quiz_results WHERE user_id = ?', [userId])?.total ?? 0;
  const gameCount = row<{ total: number }>('SELECT COUNT(*) AS total FROM game_runs WHERE user_id = ? AND finished_at IS NOT NULL AND reward_coins >= 0', [userId])?.total ?? 0;
  const bestScore = row<{ score: number }>('SELECT COALESCE(MAX(score), 0) AS score FROM game_runs WHERE user_id = ? AND reward_coins >= 0', [userId])?.score ?? 0;
  const achievements = [
    { id: 'first-session', title: '첫 궤도 진입', detail: '첫 학습 기록 남기기', progress: Math.min(1, study.length ? 1 : 0), target: 1 },
    { id: 'focus-300', title: '집중의 항해자', detail: '누적 학습 300분 달성', progress: studyMinutes, target: 300 },
    { id: 'quiz-five', title: '지식 수집가', detail: '퀴즈 5회 완료', progress: quizCount, target: 5 },
    { id: 'arena-one', title: '아레나 생존자', detail: '첫 게임 기록 저장', progress: gameCount, target: 1 },
    { id: 'score-500', title: '별 사냥꾼', detail: '한 게임에서 500점 달성', progress: bestScore, target: 500 }
  ].map(achievement => ({ ...achievement, unlocked: achievement.progress >= achievement.target }));
  res.json({ user: userView(user as Parameters<typeof userView>[0]), study, quizzes, exams, subjects, achievements });
});
const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
});
app.get('/api/plans', auth, (req: SessionRequest, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const endOfWeek = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const parsed = z.object({ start: validDate.optional(), end: validDate.optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: '학습 계획 조회 기간을 확인해 주세요.' });
  const start = parsed.data.start ?? today;
  const end = parsed.data.end ?? endOfWeek;
  const range = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime();
  if (range < 0 || range > 90 * 86400000) return res.status(400).json({ error: '조회 기간은 최대 90일까지 설정할 수 있습니다.' });
  res.json({ plans: rows(
    'SELECT id, subject, title, planned_date AS date, target_minutes AS targetMinutes, completed FROM study_plans WHERE user_id = ? AND planned_date BETWEEN ? AND ? ORDER BY planned_date, created_at',
    [req.userId, start, end]
  ) });
});
app.post('/api/plans', auth, (req: SessionRequest, res) => {
  const parsed = z.object({
    subject: z.enum(['국어', '영어', '수학', '과학', '사회']),
    title: z.string().trim().min(2).max(100),
    date: validDate,
    targetMinutes: z.number().int().min(1).max(240)
  }).safeParse(req.body);
  const today = new Date().toISOString().slice(0, 10);
  if (!parsed.success || parsed.data.date < today) return res.status(400).json({ error: '과거 날짜는 계획으로 등록할 수 없습니다.' });
  const id = createId();
  run('INSERT INTO study_plans (id, user_id, subject, title, planned_date, target_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.userId, parsed.data.subject, parsed.data.title, parsed.data.date, parsed.data.targetMinutes, now()]);
  persist();
  res.status(201).json({ id });
});
app.patch('/api/plans/:id', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ completed: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '계획 완료 상태를 확인해 주세요.' });
  const planId = routeParam(req.params.id);
  const plan = row('SELECT 1 FROM study_plans WHERE id = ? AND user_id = ?', [planId, req.userId]);
  if (!plan) return res.status(404).json({ error: '학습 계획을 찾을 수 없습니다.' });
  run('UPDATE study_plans SET completed = ? WHERE id = ? AND user_id = ?', [parsed.data.completed ? 1 : 0, planId, req.userId]);
  persist();
  res.json({ ok: true });
});
app.post('/api/study', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ subject: z.enum(['국어', '영어', '수학', '과학', '사회']), minutes: z.number().int().min(1).max(240), note: z.string().max(300).default('') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '과목과 공부 시간을 확인해 주세요.' });
  const id = createId();
  const createdAt = now();
  transaction(() => {
    run('INSERT INTO study_sessions (id, user_id, subject, minutes, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, req.userId, parsed.data.subject, parsed.data.minutes, parsed.data.note, createdAt]);
    rewardStudy(req.userId!, parsed.data.minutes, createdAt.slice(0, 10));
  });
  persist();
  res.status(201).json({ id, createdAt });
});
app.post('/api/exams', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ subject: z.enum(['국어', '영어', '수학', '과학', '사회']), title: z.string().trim().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.body);
  if (!parsed.success || parsed.data.date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: '시험 정보를 확인해 주세요.' });
  const id = createId();
  run('INSERT INTO exams (id, user_id, subject, title, exam_date) VALUES (?, ?, ?, ?, ?)', [id, req.userId, parsed.data.subject, parsed.data.title, parsed.data.date]);
  persist();
  res.status(201).json({ id });
});
app.post('/api/quizzes', auth, (req: SessionRequest, res) => {
  const parsed = z.object({
    subject: z.enum(['국어', '영어', '수학', '과학', '사회']),
    score: z.number().int().min(0),
    total: z.number().int().min(1).max(100),
    mistakes: z.array(z.object({
      question: z.string().min(1).max(1000),
      correctAnswer: z.string().min(1).max(300),
      submittedAnswer: z.string().max(300)
    })).max(100).default([])
  }).safeParse(req.body);
  if (!parsed.success || parsed.data.score > parsed.data.total) return res.status(400).json({ error: '퀴즈 결과를 확인해 주세요.' });
  const id = createId();
  const createdAt = now();
  transaction(() => {
    run('INSERT INTO quiz_results (id, user_id, subject, score, total, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, req.userId, parsed.data.subject, parsed.data.score, parsed.data.total, createdAt]);
    parsed.data.mistakes.forEach(mistake => run(
      'INSERT INTO quiz_mistakes (id, user_id, subject, question, correct_answer, submitted_answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [createId(), req.userId, parsed.data.subject, mistake.question, mistake.correctAnswer, mistake.submittedAnswer, createdAt]
    ));
    const earnedBefore = row<{ total: number }>('SELECT COALESCE(SUM(MIN(10, CAST(score * 10.0 / total AS INTEGER))), 0) AS total FROM quiz_results WHERE user_id = ? AND substr(created_at, 1, 10) = ?', [req.userId, createdAt.slice(0, 10)])?.total ?? 0;
    const thisQuizXp = Math.min(10, Math.floor(parsed.data.score / parsed.data.total * 10));
    const creditedBefore = Math.max(0, earnedBefore - thisQuizXp);
    const award = Math.min(thisQuizXp, Math.max(0, 20 - creditedBefore));
    if (award) addXp(req.userId!, award);
  });
  persist();
  res.status(201).json({ id });
});
app.get('/api/mistakes', auth, (req: SessionRequest, res) => {
  res.json({ mistakes: rows(
    'SELECT id, subject, question, correct_answer AS correctAnswer, submitted_answer AS submittedAnswer, created_at AS createdAt FROM quiz_mistakes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.userId]
  ) });
});

const missionDefinitions = [
  { id: 'study-30', title: '집중 모드 30분', detail: '오늘 학습 30분 기록하기', target: 30, coins: 20, xp: 15 },
  { id: 'quiz-one', title: '지식 탐험', detail: '오늘 퀴즈 한 번 풀기', target: 1, coins: 20, xp: 10 },
  { id: 'arena-one', title: '아레나 출격', detail: '오늘 아레나 한 번 플레이하기', target: 1, coins: 30, xp: 15 }
];
function dailyMissionProgress(userId: string, day: string) {
  const studyMinutes = row<{ total: number }>('SELECT COALESCE(SUM(minutes), 0) AS total FROM study_sessions WHERE user_id = ? AND substr(created_at, 1, 10) = ?', [userId, day])?.total ?? 0;
  const quizCount = row<{ total: number }>('SELECT COUNT(*) AS total FROM quiz_results WHERE user_id = ? AND substr(created_at, 1, 10) = ?', [userId, day])?.total ?? 0;
  const gameCount = row<{ total: number }>('SELECT COUNT(*) AS total FROM game_runs WHERE user_id = ? AND substr(started_at, 1, 10) = ? AND finished_at IS NOT NULL AND reward_coins >= 0 AND CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS INTEGER) >= 15', [userId, day])?.total ?? 0;
  const progressById: Record<string, number> = { 'study-30': studyMinutes, 'quiz-one': quizCount, 'arena-one': gameCount };
  return missionDefinitions.map(mission => ({
    ...mission,
    progress: Math.min(mission.target, progressById[mission.id] ?? 0),
    completed: (progressById[mission.id] ?? 0) >= mission.target,
    claimed: Boolean(row('SELECT 1 FROM daily_missions WHERE user_id = ? AND day = ? AND mission_id = ?', [userId, day, mission.id]))
  }));
}
app.get('/api/missions', auth, (req: SessionRequest, res) => {
  res.json({ missions: dailyMissionProgress(req.userId!, new Date().toISOString().slice(0, 10)) });
});
app.post('/api/missions/:id/claim', auth, (req: SessionRequest, res) => {
  const mission = missionDefinitions.find(item => item.id === routeParam(req.params.id));
  if (!mission) return res.status(404).json({ error: '미션을 찾을 수 없습니다.' });
  const day = new Date().toISOString().slice(0, 10);
  const progress = dailyMissionProgress(req.userId!, day).find(item => item.id === mission.id)!;
  if (!progress.completed) return res.status(400).json({ error: '미션을 먼저 완료해 주세요.' });
  if (progress.claimed) return res.status(409).json({ error: '이미 오늘 보상을 받았습니다.' });
  transaction(() => {
    run('INSERT INTO daily_missions (user_id, day, mission_id, claimed_at) VALUES (?, ?, ?, ?)', [req.userId, day, mission.id, now()]);
    run('UPDATE users SET coins = coins + ? WHERE id = ?', [mission.coins, req.userId]);
    addXp(req.userId!, mission.xp);
  });
  persist();
  res.json({ ok: true, coins: mission.coins, xp: mission.xp });
});

app.get('/api/friends', auth, (req: SessionRequest, res) => {
  const userId = req.userId!;
  const friends = rows<{ id: string; user_id: string; nickname: string; avatar: string }>(
    'SELECT u.id, u.user_id, u.nickname, u.avatar FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END WHERE f.user_a = ? OR f.user_b = ? ORDER BY u.nickname',
    [userId, userId, userId]
  );
  const incoming = rows('SELECT r.id, u.user_id, u.nickname, u.avatar FROM friend_requests r JOIN users u ON u.id = r.sender_id WHERE r.receiver_id = ? AND r.status = \'pending\' ORDER BY r.created_at DESC', [userId]);
  const outgoing = rows('SELECT r.id, u.user_id, u.nickname FROM friend_requests r JOIN users u ON u.id = r.receiver_id WHERE r.sender_id = ? AND r.status = \'pending\' ORDER BY r.created_at DESC', [userId]);
  res.json({ friends: friends.map(friend => ({ ...friend, online: onlineUsers.has(friend.id) })), incoming, outgoing });
});
app.get('/api/users/search', auth, (req: SessionRequest, res) => {
  const userId = req.userId!;
  const id = String(req.query.id ?? '').trim().toUpperCase();
  if (!/^SV\d{8}$/.test(id)) return res.status(400).json({ error: 'SV로 시작하는 사용자 ID를 입력해 주세요.' });
  const user = row<{ id: string; user_id: string; nickname: string; avatar: string }>('SELECT id, user_id, nickname, avatar FROM users WHERE user_id = ? AND id != ?', [id, userId]);
  if (!user || isBlocked(userId, user.id)) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  res.json({ user });
});
app.post('/api/friends/requests', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success || parsed.data.userId === req.userId) return res.status(400).json({ error: '친구 요청 대상을 확인해 주세요.' });
  const targetId = parsed.data.userId;
  if (!row('SELECT 1 FROM users WHERE id = ?', [targetId]) || isBlocked(req.userId!, targetId)) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  if (areFriends(req.userId!, targetId)) return res.status(409).json({ error: '이미 친구입니다.' });
  if (row('SELECT 1 FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = \'pending\'', [targetId, req.userId])) return res.status(409).json({ error: '상대방이 보낸 요청을 먼저 확인해 주세요.' });
  const existing = row('SELECT id FROM friend_requests WHERE sender_id = ? AND receiver_id = ?', [req.userId, targetId]);
  if (existing) run('UPDATE friend_requests SET status = \'pending\', created_at = ? WHERE id = ?', [now(), (existing as { id: string }).id]);
  else run('INSERT INTO friend_requests (id, sender_id, receiver_id, created_at) VALUES (?, ?, ?, ?)', [createId(), req.userId, targetId, now()]);
  persist();
  res.status(201).json({ ok: true });
});
app.post('/api/friends/requests/:id/respond', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ accept: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '요청 처리 값을 확인해 주세요.' });
  const requestId = routeParam(req.params.id);
  const request = row<{ sender_id: string }>('SELECT sender_id FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = \'pending\'', [requestId, req.userId]);
  if (!request) return res.status(404).json({ error: '친구 요청을 찾을 수 없습니다.' });
  transaction(() => {
    if (parsed.data.accept) {
      const [a, b] = friendPair(req.userId!, request.sender_id);
      run('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)', [a, b, now()]);
    }
    run('UPDATE friend_requests SET status = ? WHERE id = ?', [parsed.data.accept ? 'accepted' : 'declined', requestId]);
  });
  persist();
  res.json({ ok: true });
});
app.post('/api/users/:id/block', auth, (req: SessionRequest, res) => {
  const blockedId = routeParam(req.params.id);
  if (blockedId === req.userId || !row('SELECT 1 FROM users WHERE id = ?', [blockedId])) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  const [a, b] = friendPair(req.userId!, blockedId);
  transaction(() => {
    run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', [req.userId, blockedId, now()]);
    run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', [a, b]);
    run('UPDATE friend_requests SET status = \'blocked\' WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)', [req.userId, blockedId, blockedId, req.userId]);
  });
  persist();
  res.json({ ok: true });
});
app.post('/api/users/:id/report', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ reason: z.string().trim().min(4).max(500) }).safeParse(req.body);
  const reportedId = routeParam(req.params.id);
  if (!parsed.success || reportedId === req.userId || !row('SELECT 1 FROM users WHERE id = ?', [reportedId])) return res.status(400).json({ error: '신고 내용을 확인해 주세요.' });
  run('INSERT INTO reports (id, reporter_id, reported_id, reason, created_at) VALUES (?, ?, ?, ?, ?)', [createId(), req.userId, reportedId, parsed.data.reason, now()]);
  persist();
  res.status(201).json({ ok: true });
});

app.get('/api/conversations', auth, (req: SessionRequest, res) => {
  const conversations = rows<{ id: string; kind: string; name: string; direct_key: string | null; last_body: string | null; last_at: string | null }>(
    `SELECT c.id, c.kind, c.name,
      c.direct_key,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_at
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ? ORDER BY COALESCE(last_at, c.created_at) DESC`, [req.userId]
  );
  res.json({ conversations: conversations.filter(conversation => !conversation.direct_key || !blockedDirectKey(conversation.direct_key)).map(conversation => {
    const members = rows<{ id: string; user_id: string; nickname: string; avatar: string }>(
      'SELECT u.id, u.user_id, u.nickname, u.avatar FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ? AND u.id != ?',
      [conversation.id, req.userId]
    );
    const { direct_key: _directKey, ...visibleConversation } = conversation;
    return { ...visibleConversation, members };
  }) });
});
app.post('/api/conversations/direct/:friendId', auth, (req: SessionRequest, res) => {
  const friendId = routeParam(req.params.friendId);
  if (!areFriends(req.userId!, friendId) || isBlocked(req.userId!, friendId)) return res.status(403).json({ error: '친구와의 대화만 시작할 수 있습니다.' });
  const [a, b] = friendPair(req.userId!, friendId);
  const directKey = `${a}:${b}`;
  let conversation = row<{ id: string }>('SELECT id FROM conversations WHERE direct_key = ?', [directKey]);
  if (!conversation) {
    const id = createId();
    transaction(() => {
      run('INSERT INTO conversations (id, kind, direct_key, created_at) VALUES (?, \'direct\', ?, ?)', [id, directKey, now()]);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [id, a, id, b]);
    });
    conversation = { id };
    persist();
  }
  res.json({ id: conversation.id });
});
app.post('/api/conversations', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(50), memberIds: z.array(z.string().uuid()).min(1).max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '그룹 이름과 친구 목록을 확인해 주세요.' });
  const uniqueIds = [...new Set(parsed.data.memberIds)].filter(id => id !== req.userId);
  if (uniqueIds.length < 1 || uniqueIds.some(id => !areFriends(req.userId!, id) || isBlocked(req.userId!, id))) return res.status(403).json({ error: '그룹에는 현재 친구만 초대할 수 있습니다.' });
  const id = createId();
  transaction(() => {
    run('INSERT INTO conversations (id, kind, name, created_at) VALUES (?, \'group\', ?, ?)', [id, parsed.data.name, now()]);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [id, req.userId]);
    uniqueIds.forEach(memberId => run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [id, memberId]));
  });
  persist();
  res.status(201).json({ id });
});
app.get('/api/conversations/:id/messages', auth, (req: SessionRequest, res) => {
  const conversationId = routeParam(req.params.id);
  if (!canAccessConversation(conversationId, req.userId!)) return res.status(403).json({ error: '이 대화에 접근할 수 없습니다.' });
  res.json({ messages: rows('SELECT m.id, m.sender_id AS senderId, u.nickname, u.avatar, m.body, m.created_at AS createdAt FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 100', [conversationId]).reverse() });
});

const shop = [
  { id: 'pulse-blaster', name: '펄스 블래스터', category: 'weapon', description: '기본 공격력 +1', price: 180, max: 5 },
  { id: 'plasma-core', name: '플라즈마 코어', category: 'ability', description: '최대 체력 +15', price: 150, max: 5 },
  { id: 'nebula-suit', name: '네뷸라 슈트', category: 'skin', description: '은하빛 탐험가 스킨', price: 250, max: 1 },
  { id: 'comet-trail', name: '혜성의 궤적', category: 'skin', description: '푸른 혜성 이펙트', price: 220, max: 1 },
  { id: 'ion-boots', name: '이온 부츠', category: 'ability', description: '이동 속도 +5%', price: 140, max: 5 }
];
app.get('/api/shop', auth, (req: SessionRequest, res) => {
  res.json({
    items: shop,
    inventory: rows('SELECT item_id AS itemId, quantity, equipped FROM inventory WHERE user_id = ?', [req.userId]),
    purchases: rows('SELECT item_id AS itemId, price, purchased_at AS purchasedAt FROM purchase_history WHERE user_id = ? ORDER BY purchased_at DESC LIMIT 10', [req.userId])
  });
});
app.post('/api/shop/buy', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ itemId: z.string() }).safeParse(req.body);
  const item = shop.find(entry => entry.id === parsed.data?.itemId);
  if (!parsed.success || !item) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  const owned = row<{ quantity: number }>('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [req.userId, item.id]);
  if ((owned?.quantity ?? 0) >= item.max) return res.status(409).json({ error: '이미 최대 수량을 보유하고 있습니다.' });
  const user = row<{ coins: number }>('SELECT coins FROM users WHERE id = ?', [req.userId]);
  if (!user || user.coins < item.price) return res.status(400).json({ error: '코인이 부족합니다.' });
  transaction(() => {
    run('UPDATE users SET coins = coins - ? WHERE id = ?', [item.price, req.userId]);
    run('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, 1) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1', [req.userId, item.id]);
    run('INSERT INTO purchase_history (id, user_id, item_id, price, purchased_at) VALUES (?, ?, ?, ?, ?)', [createId(), req.userId, item.id, item.price, now()]);
  });
  persist();
  res.json({ ok: true, coins: user.coins - item.price });
});
app.post('/api/shop/equip', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ itemId: z.string(), equipped: z.boolean() }).safeParse(req.body);
  if (!parsed.success || !row('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?', [req.userId, parsed.data.itemId])) return res.status(404).json({ error: '보유한 아이템을 찾을 수 없습니다.' });
  transaction(() => {
    if (parsed.data.equipped && shop.find(item => item.id === parsed.data.itemId)?.category === 'skin') {
      run('UPDATE inventory SET equipped = 0 WHERE user_id = ? AND item_id IN (\'nebula-suit\', \'comet-trail\')', [req.userId]);
    }
    run('UPDATE inventory SET equipped = ? WHERE user_id = ? AND item_id = ?', [parsed.data.equipped ? 1 : 0, req.userId, parsed.data.itemId]);
  });
  persist();
  res.json({ ok: true });
});

type BrawlerDifficulty = 'easy' | 'medium' | 'hard';
const brawlers = [
  { id: 'momo', name: '모모', rarity: '일반', image: '🐰', color: '#78d6c1', hp: 125, attack: 14, speed: 218, attackStyle: '두 갈래 씨앗탄', specialName: '새싹 보호막', special: '3초 동안 받는 피해를 줄여요.', kit: 'seed', difficulty: ['easy'] as BrawlerDifficulty[], requiredCorrect: 0, freeDay: null, price: 0 },
  { id: 'tori', name: '토리', rarity: '일반', image: '🐿️', color: '#ffc16b', hp: 115, attack: 19, speed: 225, attackStyle: '짧은 거리 솔방울', specialName: '다람쥐 질주', special: '잠시 이동 속도가 크게 올라요.', kit: 'cone', difficulty: ['easy'] as BrawlerDifficulty[], requiredCorrect: 3, freeDay: 1, price: 18 },
  { id: 'raon', name: '라온', rarity: '초희귀', image: '🦊', color: '#f39975', hp: 135, attack: 17, speed: 211, attackStyle: '세 방향 별조각', specialName: '별빛 울타리', special: '주변에 보호 울타리를 만들고 적을 밀어내요.', kit: 'fan', difficulty: ['medium'] as BrawlerDifficulty[], requiredCorrect: 3, freeDay: 2, price: 38 },
  { id: 'lumi', name: '루미', rarity: '희귀', image: '🦉', color: '#a995ed', hp: 108, attack: 25, speed: 205, attackStyle: '관통하는 지식 광선', specialName: '반짝이는 통찰', special: '앞쪽으로 넓은 지식 파동을 보내요.', kit: 'beam', difficulty: ['easy', 'medium'] as BrawlerDifficulty[], requiredCorrect: 3, freeDay: 3, price: 30 },
  { id: 'naeul', name: '나을', rarity: '신화', image: '🐼', color: '#7fa8df', hp: 150, attack: 15, speed: 195, attackStyle: '돌아오는 종이비행기', specialName: '함께 숨 고르기', special: '자신과 팀 동료의 컨디션을 회복해요.', kit: 'return', difficulty: ['hard'] as BrawlerDifficulty[], requiredCorrect: 3, freeDay: 4, price: 82 },
  { id: 'garam', name: '가람', rarity: '영웅', image: '🐸', color: '#78cf91', hp: 120, attack: 21, speed: 230, attackStyle: '물결이 퍼지는 물방울', specialName: '산뜻한 파도', special: '원형 파도를 만들어 가까운 적을 밀어내요.', kit: 'wave', difficulty: ['medium', 'hard'] as BrawlerDifficulty[], requiredCorrect: 3, freeDay: 5, price: 62 },
  { id: 'haeul', name: '하을', rarity: '전설', image: '🐉', color: '#f2a0cb', hp: 105, attack: 29, speed: 220, attackStyle: '빠른 혜성 연속탄', specialName: '오로라 질주', special: '빠르게 이동하며 주변 적에게 충격을 줘요.', kit: 'comet', difficulty: ['hard'] as BrawlerDifficulty[], requiredCorrect: 4, freeDay: 6, price: 110 },
  { id: 'byeori', name: '별이', rarity: '신화', image: '🦋', color: '#80d4ea', hp: 118, attack: 23, speed: 215, attackStyle: '나선형 달빛', specialName: '달빛 회복', special: '체력을 회복하고 특수 에너지를 채워요.', kit: 'orbit', difficulty: ['medium', 'hard'] as BrawlerDifficulty[], requiredCorrect: 4, freeDay: 0, price: 88 }
] as const;
type Brawler = typeof brawlers[number];
const brawlerQuestions: {
  id: string; subject: string; difficulty: BrawlerDifficulty; question: string;
  options: string[]; answer: string; explanation: string;
}[] = [
  { id: 'math-e-1', subject: '수학', difficulty: 'easy', question: '8 + 7의 값은 무엇인가요?', options: ['13', '14', '15', '16'], answer: '15', explanation: '8에 7을 더하면 15입니다.' },
  { id: 'english-e-1', subject: '영어', difficulty: 'easy', question: '“apple”의 뜻은 무엇인가요?', options: ['사과', '배', '포도', '복숭아'], answer: '사과', explanation: 'apple은 사과를 뜻합니다.' },
  { id: 'science-e-1', subject: '과학', difficulty: 'easy', question: '식물이 햇빛을 이용해 양분을 만드는 과정은 무엇인가요?', options: ['증발', '광합성', '응결', '발효'], answer: '광합성', explanation: '식물은 광합성으로 빛 에너지를 양분으로 저장합니다.' },
  { id: 'social-e-1', subject: '사회', difficulty: 'easy', question: '우리나라의 수도는 어디인가요?', options: ['부산', '서울', '대전', '광주'], answer: '서울', explanation: '대한민국의 수도는 서울특별시입니다.' },
  { id: 'math-e-2', subject: '수학', difficulty: 'easy', question: '한 변이 5cm인 정사각형의 둘레는 몇 cm인가요?', options: ['10', '15', '20', '25'], answer: '20', explanation: '정사각형 둘레는 한 변의 길이 × 4입니다.' },
  { id: 'english-e-2', subject: '영어', difficulty: 'easy', question: '“She ___ a student.”에 알맞은 말은?', options: ['am', 'is', 'are', 'be'], answer: 'is', explanation: '3인칭 단수 주어 She에는 is를 사용합니다.' },
  { id: 'science-e-2', subject: '과학', difficulty: 'easy', question: '물이 얼 때 상태는 어떻게 변하나요?', options: ['고체에서 액체', '액체에서 고체', '기체에서 액체', '고체에서 기체'], answer: '액체에서 고체', explanation: '물은 얼면서 액체에서 고체인 얼음으로 변합니다.' },
  { id: 'social-e-2', subject: '사회', difficulty: 'easy', question: '지도에서 실제 거리를 줄여 나타낸 비율은 무엇인가요?', options: ['방위', '축척', '등고선', '범례'], answer: '축척', explanation: '축척은 지도상의 거리와 실제 거리의 비율입니다.' },
  { id: 'math-m-1', subject: '수학', difficulty: 'medium', question: 'x + 9 = 16일 때 x의 값은?', options: ['5', '6', '7', '8'], answer: '7', explanation: '양쪽에서 9를 빼면 x = 7입니다.' },
  { id: 'english-m-1', subject: '영어', difficulty: 'medium', question: '“went”의 기본형은 무엇인가요?', options: ['go', 'gone', 'goes', 'going'], answer: 'go', explanation: 'went는 go의 과거형입니다.' },
  { id: 'science-m-1', subject: '과학', difficulty: 'medium', question: '지구가 태양 주위를 한 바퀴 도는 데 걸리는 시간은?', options: ['하루', '한 달', '약 1년', '약 10년'], answer: '약 1년', explanation: '지구의 공전 주기는 약 1년입니다.' },
  { id: 'social-m-1', subject: '사회', difficulty: 'medium', question: '지방 자치 단체의 일을 결정하는 대표 기관은?', options: ['지방 의회', '법원', '은행', '도서관'], answer: '지방 의회', explanation: '지방 의회는 지역 주민을 대표해 조례와 예산 등을 심의합니다.' },
  { id: 'math-m-2', subject: '수학', difficulty: 'medium', question: '밑변 8cm, 높이 5cm인 삼각형의 넓이는?', options: ['13cm²', '20cm²', '40cm²', '80cm²'], answer: '20cm²', explanation: '삼각형 넓이는 밑변 × 높이 ÷ 2입니다.' },
  { id: 'english-m-2', subject: '영어', difficulty: 'medium', question: '“There are ___ books.”에 알맞은 말은?', options: ['much', 'any', 'three', 'is'], answer: 'three', explanation: '복수 명사 books의 수를 셀 때 수량 표현을 사용할 수 있습니다.' },
  { id: 'science-m-2', subject: '과학', difficulty: 'medium', question: '자석의 같은 극끼리는 어떻게 되나요?', options: ['서로 끌어당긴다', '서로 밀어낸다', '항상 붙는다', '자성이 사라진다'], answer: '서로 밀어낸다', explanation: '자석의 같은 극은 서로 밀어내고 다른 극은 끌어당깁니다.' },
  { id: 'social-m-2', subject: '사회', difficulty: 'medium', question: '물건의 가격이 오를 때 소비량이 줄어드는 경향을 무엇이라 하나요?', options: ['수요 법칙', '공전', '분업', '인구 이동'], answer: '수요 법칙', explanation: '다른 조건이 같다면 가격과 수요량은 반대 방향으로 움직이는 경향이 있습니다.' },
  { id: 'math-h-1', subject: '수학', difficulty: 'hard', question: '2x - 5 = 13일 때 x는?', options: ['4', '8', '9', '18'], answer: '9', explanation: '양변에 5를 더하면 2x = 18, 따라서 x = 9입니다.' },
  { id: 'english-h-1', subject: '영어', difficulty: 'hard', question: '“If I ___ time, I would read more.”에 알맞은 말은?', options: ['have', 'had', 'will have', 'am having'], answer: 'had', explanation: '현재 사실과 다른 가정을 나타내는 가정법 과거에서는 If절에 과거형을 씁니다.' },
  { id: 'science-h-1', subject: '과학', difficulty: 'hard', question: '전압이 일정할 때 저항이 커지면 전류는 어떻게 되나요?', options: ['커진다', '작아진다', '변하지 않는다', '항상 0이 된다'], answer: '작아진다', explanation: '옴의 법칙 I = V/R에 따라 저항이 커지면 전류는 작아집니다.' },
  { id: 'social-h-1', subject: '사회', difficulty: 'hard', question: '수요와 공급이 만나는 지점에서 결정되는 가격은?', options: ['최저 임금', '균형 가격', '수입 가격', '공공 요금'], answer: '균형 가격', explanation: '수요량과 공급량이 일치하는 지점의 가격을 균형 가격이라고 합니다.' },
  { id: 'math-h-2', subject: '수학', difficulty: 'hard', question: '3, 5, 7, 9, 11의 중앙값은?', options: ['5', '7', '8', '9'], answer: '7', explanation: '자료를 순서대로 놓았을 때 가운데 있는 값은 7입니다.' },
  { id: 'english-h-2', subject: '영어', difficulty: 'hard', question: '“The letter was ___ by Mina.”에 알맞은 말은?', options: ['write', 'wrote', 'written', 'writing'], answer: 'written', explanation: '수동태 be동사 뒤에는 과거분사 written이 옵니다.' },
  { id: 'science-h-2', subject: '과학', difficulty: 'hard', question: '광합성에 필요한 물질과 에너지를 바르게 짝지은 것은?', options: ['산소와 포도당', '물과 이산화 탄소, 빛에너지', '질소와 열에너지', '염분과 산소'], answer: '물과 이산화 탄소, 빛에너지', explanation: '광합성은 물과 이산화 탄소를 이용해 빛에너지로 양분을 만듭니다.' },
  { id: 'social-h-2', subject: '사회', difficulty: 'hard', question: '서로 다른 지역이 잘 만드는 상품을 교환해 함께 이익을 얻는 원리는?', options: ['절대 왕정', '비교 우위에 따른 무역', '인구 피라미드', '수직 이동'], answer: '비교 우위에 따른 무역', explanation: '각 지역이 상대적으로 유리한 상품에 집중하면 교역을 통해 이익을 얻을 수 있습니다.' }
];
const brawlerWalletId = (userId: string) => `game-brawler-wallet:${userId}`;
const brawlerSelectedId = (userId: string) => `game-brawler-selected:${userId}`;
const brawlerOwnedId = (userId: string, brawlerId: string) => `game-brawler-owned:${userId}:${brawlerId}`;
const seoulWeekday = () => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date());
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[day as 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'];
};
function ensureBrawlerProfile(userId: string) {
  if (row('SELECT 1 FROM game_runs WHERE id = ?', [brawlerWalletId(userId)])) return false;
  transaction(() => {
    run('INSERT OR IGNORE INTO game_runs (id, user_id, started_at, finished_at, score, reward_coins) VALUES (?, ?, ?, ?, 120, -1)', [brawlerWalletId(userId), userId, now(), now()]);
    run('INSERT OR IGNORE INTO game_runs (id, user_id, started_at, finished_at, score, reward_coins) VALUES (?, ?, ?, ?, 0, -1)', [brawlerOwnedId(userId, 'momo'), userId, now(), now()]);
    run('INSERT OR IGNORE INTO game_runs (id, user_id, started_at, finished_at, score, reward_coins) VALUES (?, ?, ?, ?, 0, -1)', [brawlerSelectedId(userId), userId, now(), now()]);
  });
  persist();
  return true;
}
function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index--) {
    const other = crypto.randomInt(index + 1);
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}
app.get('/api/game/brawlers', auth, (req: SessionRequest, res) => {
  const userId = req.userId!;
  ensureBrawlerProfile(userId);
  const wallet = row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerWalletId(userId), userId]);
  const owned = rows<{ id: string }>('SELECT id FROM game_runs WHERE user_id = ? AND reward_coins = -1 AND id LIKE ?', [userId, `game-brawler-owned:${userId}:%`])
    .map(item => item.id.slice(`game-brawler-owned:${userId}:`.length));
  const selectedIndex = row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerSelectedId(userId), userId])?.score ?? 0;
  const today = seoulWeekday();
  res.json({
    gems: wallet?.score ?? 0,
    weekday: today,
    freeBrawlerId: brawlers.find(item => item.freeDay === today)?.id ?? null,
    selectedBrawlerId: brawlers[selectedIndex]?.id ?? 'momo',
    owned,
    brawlers: brawlers.map(({ difficulty: _difficulty, ...brawler }) => ({ ...brawler, freeToday: brawler.freeDay === today, owned: owned.includes(brawler.id) }))
  });
});
app.post('/api/game/brawlers/select', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ brawlerId: z.string().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '선택할 브롤러를 확인해 주세요.' });
  const brawlerIndex = brawlers.findIndex(item => item.id === parsed.data.brawlerId);
  if (brawlerIndex < 0 || !row('SELECT 1 FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerOwnedId(req.userId!, parsed.data.brawlerId), req.userId])) return res.status(403).json({ error: '보유한 브롤러만 선택할 수 있습니다.' });
  ensureBrawlerProfile(req.userId!);
  run('UPDATE game_runs SET score = ? WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerIndex, brawlerSelectedId(req.userId!), req.userId]);
  persist();
  res.json({ ok: true, selectedBrawlerId: parsed.data.brawlerId });
});
app.post('/api/game/brawlers/challenge', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ brawlerId: z.string().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '도전할 브롤러를 확인해 주세요.' });
  const brawler = brawlers.find(item => item.id === parsed.data.brawlerId);
  if (!brawler || !brawler.requiredCorrect) return res.status(404).json({ error: '퀴즈로 획득할 수 있는 브롤러가 아닙니다.' });
  ensureBrawlerProfile(req.userId!);
  const userId = req.userId!;
  if (row('SELECT 1 FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerOwnedId(userId, brawler.id), userId])) return res.status(409).json({ error: '이미 보유한 브롤러입니다.' });
  const isFree = brawler.freeDay === seoulWeekday();
  const wallet = row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerWalletId(userId), userId]);
  if (!isFree && (!wallet || wallet.score < brawler.price)) return res.status(400).json({ error: `보석이 부족합니다. 필요한 보석: ${brawler.price}` });
  const pool = brawlerQuestions.filter(question => brawler.difficulty.includes(question.difficulty));
  const chosen = shuffle(pool).slice(0, 4);
  const questionData = chosen.map(question => ({ ...question, options: shuffle([...question.options]) }));
  const attemptId = createId();
  const challengeToken = jwt.sign({
    kind: 'arena-brawler-quiz', sub: userId, attemptId, brawlerId: brawler.id,
    questionIds: questionData.map(question => question.id), options: questionData.map(question => question.options)
  }, jwtSecret!, { expiresIn: '30m' });
  const attemptError = transaction(() => {
    const currentWallet = row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerWalletId(userId), userId]);
    if (row('SELECT 1 FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerOwnedId(userId, brawler.id), userId])) return 'owned';
    if (!isFree && (!currentWallet || currentWallet.score < brawler.price)) return 'gems';
    if (!isFree) run('UPDATE game_runs SET score = score - ? WHERE id = ? AND user_id = ? AND score >= ? AND reward_coins = -1', [brawler.price, brawlerWalletId(userId), userId, brawler.price]);
    run('INSERT INTO game_runs (id, user_id, started_at, score, reward_coins) VALUES (?, ?, ?, 0, -1)', [`game-brawler-quiz:${attemptId}`, userId, now()]);
    return null;
  });
  if (attemptError === 'owned') return res.status(409).json({ error: '이미 보유한 브롤러입니다.' });
  if (attemptError === 'gems') return res.status(400).json({ error: `보석이 부족합니다. 필요한 보석: ${brawler.price}` });
  persist();
  res.status(201).json({
    challengeToken, isFree, gems: (wallet?.score ?? 0) - (isFree ? 0 : brawler.price),
    brawler: { id: brawler.id, name: brawler.name, image: brawler.image, rarity: brawler.rarity, requiredCorrect: brawler.requiredCorrect },
    questions: questionData.map(({ id, subject, difficulty, question, options }) => ({ id, subject, difficulty, question, options }))
  });
});
app.post('/api/game/brawlers/answer', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ challengeToken: z.string().min(1).max(8000), questionIndex: z.number().int().min(0).max(3), answerIndex: z.number().int().min(0).max(3) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '답안을 확인해 주세요.' });
  let token: jwt.JwtPayload;
  try { token = jwt.verify(parsed.data.challengeToken, jwtSecret!) as jwt.JwtPayload; }
  catch { return res.status(401).json({ error: '퀴즈 시간이 만료되었습니다. 다시 도전해 주세요.' }); }
  const ids = token.questionIds, options = token.options;
  if (token.kind !== 'arena-brawler-quiz' || token.sub !== req.userId || typeof token.attemptId !== 'string' || typeof token.brawlerId !== 'string' ||
      !Array.isArray(ids) || ids.length !== 4 || !Array.isArray(options) || options.length !== 4 ||
      options.some(item => !Array.isArray(item) || item.length !== 4 || item.some(option => typeof option !== 'string'))) return res.status(400).json({ error: '퀴즈 정보를 확인할 수 없습니다.' });
  const index = parsed.data.questionIndex;
  const question = brawlerQuestions.find(item => item.id === ids[index]);
  const brawler = brawlers.find(item => item.id === token.brawlerId);
  if (!question || !brawler) return res.status(400).json({ error: '문제 정보를 확인할 수 없습니다.' });
  const attemptRunId = `game-brawler-quiz:${token.attemptId}`;
  const attempt = row<{ score: number; started_at: string }>('SELECT score, started_at FROM game_runs WHERE id = ? AND user_id = ? AND finished_at IS NULL AND reward_coins = -1', [attemptRunId, req.userId]);
  if (!attempt || attempt.score % 10 !== index || Date.now() - new Date(attempt.started_at).getTime() > 30 * 60 * 1000) return res.status(409).json({ error: '이미 제출했거나 만료된 퀴즈입니다.' });
  const choiceList = options[index] as string[];
  const selectedAnswer = choiceList[parsed.data.answerIndex];
  if (typeof selectedAnswer !== 'string') return res.status(400).json({ error: '선택한 답안을 찾을 수 없습니다.' });
  const correct = selectedAnswer === question.answer;
  const priorCorrect = Math.floor(attempt.score / 10);
  const correctCount = priorCorrect + (correct ? 1 : 0);
  const isLast = index === 3;
  const passed = isLast && correctCount >= brawler.requiredCorrect;
  transaction(() => {
    if (isLast) {
      run('DELETE FROM game_runs WHERE id = ? AND user_id = ? AND finished_at IS NULL AND reward_coins = -1', [attemptRunId, req.userId]);
      if (passed) {
        run('INSERT OR IGNORE INTO game_runs (id, user_id, started_at, finished_at, score, reward_coins) VALUES (?, ?, ?, ?, 0, -1)', [brawlerOwnedId(req.userId!, brawler.id), req.userId, now(), now()]);
      }
    } else {
      run('UPDATE game_runs SET score = ? WHERE id = ? AND user_id = ? AND finished_at IS NULL AND reward_coins = -1', [correctCount * 10 + index + 1, attemptRunId, req.userId]);
    }
  });
  persist();
  res.json({
    correct, correctAnswer: question.answer, explanation: question.explanation,
    questionIndex: index, correctCount, total: 4, completed: isLast, passed,
    brawler: passed ? { id: brawler.id, name: brawler.name, image: brawler.image, rarity: brawler.rarity } : null,
    gems: row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerWalletId(req.userId!), req.userId])?.score ?? 0
  });
});

app.post('/api/game/start', auth, (req: SessionRequest, res) => {
  ensureBrawlerProfile(req.userId!);
  const upgrades = rows<{ item_id: string; quantity: number; equipped: number }>('SELECT item_id, quantity, equipped FROM inventory WHERE user_id = ?', [req.userId]);
  const count = (id: string) => upgrades.find(item => item.item_id === id)?.quantity ?? 0;
  const equippedSkin = upgrades.find(item => item.equipped && ['nebula-suit', 'comet-trail'].includes(item.item_id))?.item_id;
  const selectedIndex = row<{ score: number }>('SELECT score FROM game_runs WHERE id = ? AND user_id = ? AND reward_coins = -1', [brawlerSelectedId(req.userId!), req.userId])?.score ?? 0;
  const brawler = brawlers[selectedIndex] ?? brawlers[0];
  const id = createId();
  run('INSERT INTO game_runs (id, user_id, started_at) VALUES (?, ?, ?)', [id, req.userId, now()]);
  persist();
  res.status(201).json({
    runId: id,
    playerStats: {
      maxHp: brawler.hp + count('plasma-core') * 15,
      power: brawler.attack + count('pulse-blaster'),
      speed: Math.round(brawler.speed * (1 + count('ion-boots') * 0.05)),
      color: equippedSkin === 'nebula-suit' ? '#f296d0' : brawler.color,
      brawler: { id: brawler.id, name: brawler.name, rarity: brawler.rarity, image: brawler.image, attackStyle: brawler.attackStyle, specialName: brawler.specialName, special: brawler.special, kit: brawler.kit }
    }
  });
});
app.post('/api/game/finish', auth, (req: SessionRequest, res) => {
  const parsed = z.object({ runId: z.string().uuid(), score: z.number().int().min(0).max(100000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '게임 결과를 확인해 주세요.' });
  const game = row<{ started_at: string; finished_at: string | null; reward_coins: number }>('SELECT started_at, finished_at, reward_coins FROM game_runs WHERE id = ? AND user_id = ?', [parsed.data.runId, req.userId]);
  if (!game || game.finished_at || game.reward_coins < 0) return res.status(409).json({ error: '이미 처리된 게임 기록입니다.' });
  const elapsed = Date.now() - new Date(game.started_at).getTime();
  if (elapsed < 15000) {
    transaction(() => run('UPDATE game_runs SET finished_at = ?, score = 0 WHERE id = ?', [now(), parsed.data.runId]));
    persist();
    return res.json({ coins: 0, xp: 0, gems: 0, rewardsLimited: false });
  }
  if (parsed.data.score > Math.floor(elapsed / 1000 * 35)) return res.status(400).json({ error: '플레이 시간에 비해 점수가 비정상적입니다.' });
  const today = new Date().toISOString().slice(0, 10);
  const runsToday = row<{ count: number }>('SELECT COUNT(*) AS count FROM game_runs WHERE user_id = ? AND substr(started_at, 1, 10) = ? AND finished_at IS NOT NULL AND reward_coins >= 0', [req.userId, today])?.count ?? 0;
  const coins = runsToday < 5 ? Math.min(100, Math.floor(parsed.data.score / 10)) : 0;
  const xp = runsToday < 5 ? Math.min(50, Math.floor(parsed.data.score / 5)) : 0;
  const gems = runsToday < 5 ? 5 : 0;
  if (gems) ensureBrawlerProfile(req.userId!);
  transaction(() => {
    run('UPDATE game_runs SET finished_at = ?, score = ?, reward_coins = ? WHERE id = ?', [now(), parsed.data.score, coins, parsed.data.runId]);
    run('UPDATE users SET coins = coins + ? WHERE id = ?', [coins, req.userId]);
    if (gems) run('UPDATE game_runs SET score = score + ? WHERE id = ? AND user_id = ? AND reward_coins = -1', [gems, brawlerWalletId(req.userId!), req.userId]);
    if (xp) addXp(req.userId!, xp);
  });
  persist();
  res.json({ coins, xp, gems, rewardsLimited: runsToday >= 5 });
});

const httpServer = app.listen(port, () => console.log(`STUDYVERSE API listening on http://localhost:${port}`));
const io = new Server(httpServer, {
  cors: process.env.NODE_ENV === 'production'
    ? { origin: process.env.CLIENT_URL, credentials: true }
    : { origin: true, credentials: true }
});
io.use((socket, next) => {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');
    const token = cookies.studyverse_session;
    if (!token) return next(new Error('로그인이 필요합니다.'));
    const payload = jwt.verify(token, jwtSecret!) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return next(new Error('로그인 정보가 올바르지 않습니다.'));
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error('로그인 정보가 만료되었습니다.'));
  }
});
io.on('connection', socket => {
  const userId = socket.data.userId as string;
  const wasOnline = onlineUsers.has(userId);
  socket.join(`user:${userId}`);
  onlineUsers.add(userId);
  const friendIds = rows<{ user_id: string }>(
    'SELECT u.id AS user_id FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END WHERE f.user_a = ? OR f.user_b = ?',
    [userId, userId, userId]
  ).map(friend => friend.user_id);
  socket.emit('presence:initial', friendIds.filter(friendId => onlineUsers.has(friendId)));
  if (!wasOnline) friendIds.forEach(friendId => io.to(`user:${friendId}`).emit('presence:update', { userId, online: true }));
  socket.on('conversation:join', (conversationId: unknown) => {
    if (typeof conversationId === 'string' && canAccessConversation(conversationId, userId)) socket.join(`conversation:${conversationId}`);
  });
  socket.on('message:send', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string; message?: object }) => void) => {
    const parsed = z.object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).safeParse(payload);
    if (!parsed.success || !canAccessConversation(parsed.data?.conversationId ?? '', userId)) {
      acknowledge?.({ ok: false, error: '대화 권한이 없거나 메시지가 올바르지 않습니다.' });
      return;
    }
    const conversation = row<{ kind: string; direct_key: string | null }>('SELECT kind, direct_key FROM conversations WHERE id = ?', [parsed.data.conversationId]);
    if (conversation?.kind === 'direct' && conversation.direct_key) {
      const [a, b] = conversation.direct_key.split(':');
      if (isBlocked(a, b)) {
        acknowledge?.({ ok: false, error: '차단된 사용자와는 대화할 수 없습니다.' });
        return;
      }
    }
    const message = {
      id: createId(), senderId: userId,
      nickname: row<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', [userId])?.nickname ?? '사용자',
      body: parsed.data.body, createdAt: now(), conversationId: parsed.data.conversationId
    };
    run('INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [message.id, message.conversationId, userId, message.body, message.createdAt]);
    persist();
    io.to(`conversation:${message.conversationId}`).emit('message:new', message);
    acknowledge?.({ ok: true, message });
  });
  socket.on('disconnect', () => {
    if (io.sockets.adapter.rooms.get(`user:${userId}`)?.size) return;
    onlineUsers.delete(userId);
    friendIds.forEach(friendId => io.to(`user:${friendId}`).emit('presence:update', { userId, online: false }));
  });
});

const builtClient = path.resolve(root, '../dist');
if (fs.existsSync(builtClient)) app.use(express.static(builtClient));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && fs.existsSync(path.join(builtClient, 'index.html'))) {
    return res.sendFile(path.join(builtClient, 'index.html'));
  }
  next();
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: '서버에서 요청을 처리하지 못했습니다.' });
});
process.on('SIGINT', () => {
  persist();
  io.close();
  db.close();
  process.exit(0);
});
