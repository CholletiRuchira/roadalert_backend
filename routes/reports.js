const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db');
const { authenticate, requireAuthority } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

router.post('/', authenticate, upload.single('image'), async (req, res) => {
  const { title, description, location_text,
          latitude, longitude, severity, hazard_type } = req.body;

  if (!title || !location_text || !severity || !hazard_type)
    return res.status(400).json({ error: 'Required fields missing' });

  try {
    const id        = uuidv4();
    const image_url = req.file ? '/uploads/' + req.file.filename : null;

    await pool.execute(
      `INSERT INTO reports
        (id, title, description, location_text, latitude, longitude,
         severity, hazard_type, image_url, reporter_id, reporter_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description || null, location_text,
       latitude || null, longitude || null,
       severity, hazard_type, image_url,
       req.user.id, req.user.name]
    );

    await pool.execute(
      `INSERT INTO activity_log (id, report_id, actor_id, actor_name, action)
       VALUES (?, ?, ?, ?, 'submitted')`,
      [uuidv4(), id, req.user.id, req.user.name]
    );

    res.status(201).json({ message: 'Report submitted', id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/stats', authenticate, requireAuthority, async (req, res) => {
  try {
    const [[{ total }]]       = await pool.execute('SELECT COUNT(*) as total FROM reports');
    const [[{ pending }]]     = await pool.execute("SELECT COUNT(*) as pending FROM reports WHERE status='pending'");
    const [[{ in_progress }]] = await pool.execute("SELECT COUNT(*) as in_progress FROM reports WHERE status='in_progress'");
    const [[{ resolved }]]    = await pool.execute("SELECT COUNT(*) as resolved FROM reports WHERE status='resolved'");
    const [[{ critical }]]    = await pool.execute("SELECT COUNT(*) as critical FROM reports WHERE severity='critical'");

    const [by_severity] = await pool.execute('SELECT severity, COUNT(*) as count FROM reports GROUP BY severity');
    const [by_status]   = await pool.execute('SELECT status, COUNT(*) as count FROM reports GROUP BY status');
    const [by_hazard]   = await pool.execute('SELECT hazard_type, COUNT(*) as count FROM reports GROUP BY hazard_type ORDER BY count DESC');
    const [recent]      = await pool.execute('SELECT * FROM reports ORDER BY created_at DESC LIMIT 5');

    res.json({ total, pending, in_progress, resolved, critical,
               by_severity, by_status, by_hazard, recent });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', authenticate, async (req, res) => {
  const { status, severity, hazard_type, search } = req.query;

  try {
    let query    = 'SELECT * FROM reports WHERE 1=1';
    const params = [];

    if (req.user.role !== 'authority') {
      query += ' AND reporter_id = ?';
      params.push(req.user.id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    if (hazard_type) {
      query += ' AND hazard_type = ?';
      params.push(hazard_type);
    }
    if (search) {
      query += ' AND (title LIKE ? OR location_text LIKE ?)';
      params.push('%' + search + '%', '%' + search + '%');
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.execute(query, params);
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM reports WHERE id = ?', [req.params.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: 'Not found' });

    const report = rows[0];

    if (req.user.role !== 'authority' && report.reporter_id !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });

    const [activity] = await pool.execute(
      'SELECT * FROM activity_log WHERE report_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({ ...report, activity });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/status', authenticate, requireAuthority, async (req, res) => {
  const { status, action_notes } = req.body;
  const valid = ['pending','under_review','in_progress','resolved','rejected'];

  if (!valid.includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  try {
    await pool.execute(
      `UPDATE reports
       SET status = ?, action_notes = ?, assigned_to = ?
       WHERE id = ?`,
      [status, action_notes || null, req.user.id, req.params.id]
    );

    await pool.execute(
      `INSERT INTO activity_log (id, report_id, actor_id, actor_name, action, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), req.params.id, req.user.id, req.user.name, status, action_notes || null]
    );

    res.json({ message: 'Status updated' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authenticate, requireAuthority, async (req, res) => {
  try {
    await pool.execute('DELETE FROM activity_log WHERE report_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM reports WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
