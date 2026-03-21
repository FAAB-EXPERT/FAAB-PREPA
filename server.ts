import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import duckdb from "duckdb";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import * as pdf_parse from "pdf-parse";
import Tesseract from "tesseract.js";
import fs from "fs";
import axios from "axios";
import { Request, Response } from "express";

const pdf = (pdf_parse as any).default || pdf_parse;

const app = express();
const PORT = 3000;
const upload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

interface MulterRequest extends Request {
  file?: any; // Using any to avoid complex Multer type issues in this environment
}

// Initialize DuckDB
const db = new duckdb.Database(":memory:"); // Using in-memory for now, can be a file
const conn = db.connect();

app.use(express.json());

// Helper to run SQL
const runQuery = (sql: string, params: any[] = []): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    conn.all(sql, ...params, (err: any, res: any) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
};

// API Routes
app.post("/api/collect/csv", upload.single("file"), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const buffer = fs.readFileSync(req.file.path);
    const content = buffer.toString("utf-8");
    
    // Try to detect delimiter
    let delimiter = ",";
    if (content.includes(";") && !content.includes(",")) delimiter = ";";
    if (content.includes("\t") && !content.includes(",")) delimiter = "\t";

    const records = parseCsv(content, { 
      columns: true, 
      skip_empty_lines: true, 
      relax_column_count: true,
      delimiter: delimiter
    });
    
    const tableName = `csv_${Date.now()}`;
    if (records.length > 0) {
      const columns = Object.keys(records[0]);
      const safeColumns = columns.map(c => `"${c.replace(/"/g, '""')}"`);
      await runQuery(`CREATE TABLE ${tableName} (${safeColumns.map(c => `${c} TEXT`).join(", ")})`);
      
      const placeholders = columns.map(() => "?").join(", ");
      const stmt = conn.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
      for (const row of records) {
        const values = columns.map(c => String(row[c] || ''));
        stmt.run(...values);
      }
      stmt.finalize();
    }
    
    res.json({ tableName, count: records.length });
  } catch (error) {
    console.error("[CSV Import Error]", error);
    res.status(500).json({ error: String(error) });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.post("/api/collect/excel", upload.single("file"), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error("Worksheet not found");

    const records: any[] = [];
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => {
      headers.push(String(cell.value));
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: any = {};
      headers.forEach((header, index) => {
        const cell = row.getCell(index + 1);
        record[header] = cell.value;
      });
      records.push(record);
    });

    const tableName = `excel_${Date.now()}`;
    if (records.length > 0) {
      const safeHeaders = headers.map(h => `"${h.replace(/"/g, '""')}"`);
      await runQuery(`CREATE TABLE ${tableName} (${safeHeaders.map(c => `${c} TEXT`).join(", ")})`);
      
      const placeholders = headers.map(() => "?").join(", ");
      const stmt = conn.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
      for (const row of records) {
        const values = headers.map(h => String(row[h] || ''));
        stmt.run(...values);
      }
      stmt.finalize();
    }
    
    res.json({ tableName, count: records.length });
  } catch (error) {
    console.error("[Excel Import Error]", error);
    res.status(500).json({ error: String(error) });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.post("/api/collect/json", upload.single("file"), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const content = fs.readFileSync(req.file.path, "utf-8");
    let records = JSON.parse(content);
    if (!Array.isArray(records)) records = [records];
    
    const tableName = `json_${Date.now()}`;
    if (records.length > 0) {
      const columns = Object.keys(records[0]);
      const safeColumns = columns.map(c => `"${c.replace(/"/g, '""')}"`);
      await runQuery(`CREATE TABLE ${tableName} (${safeColumns.map(c => `${c} TEXT`).join(", ")})`);
      
      const placeholders = columns.map(() => "?").join(", ");
      const stmt = conn.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
      for (const row of records) {
        const values = columns.map(c => String(row[c] || ''));
        stmt.run(...values);
      }
      stmt.finalize();
    }
    
    res.json({ tableName, count: records.length });
  } catch (error) {
    console.error("[JSON Import Error]", error);
    res.status(500).json({ error: String(error) });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.get("/api/data/:tableName", async (req, res) => {
  try {
    const { tableName } = req.params;
    const limit = req.query.limit || 100;
    const data = await runQuery(`SELECT * FROM ${tableName} LIMIT ${limit}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/filter", async (req, res) => {
  try {
    const { sourceTable, filters, limit } = req.body;
    const targetTable = `filtered_${Date.now()}`;
    let whereClause = "1=1";
    if (filters && filters.length > 0) {
      whereClause = filters.map((f: any) => `"${f.column}" ${f.operator} '${f.value}'`).join(" AND ");
    }
    await runQuery(`CREATE TABLE ${targetTable} AS SELECT * FROM ${sourceTable} WHERE ${whereClause} LIMIT ${limit || 1000000}`);
    res.json({ tableName: targetTable });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/audit", async (req, res) => {
  try {
    const { tableName } = req.body;
    const columns = await runQuery(`PRAGMA table_info(${tableName})`);
    const auditResults: any = {};
    
    for (const col of columns) {
      const name = col.name;
      const nullCount = await runQuery(`SELECT COUNT(*) as count FROM ${tableName} WHERE "${name}" IS NULL OR "${name}" = ''`);
      auditResults[name] = {
        nullCount: nullCount[0].count,
      };
    }
    
    const totalCount = await runQuery(`SELECT COUNT(*) as count FROM ${tableName}`);
    const duplicateCount = await runQuery(`SELECT COUNT(*) - COUNT(DISTINCT *) as count FROM ${tableName}`);
    
    res.json({
      totalCount: totalCount[0].count,
      duplicateCount: duplicateCount[0].count,
      columnAudit: auditResults
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/clean", async (req, res) => {
  try {
    const { sourceTable, operations } = req.body;
    const targetTable = `cleaned_${Date.now()}`;
    
    // operations: { column: string, type: 'coalesce' | 'cast' | 'case', value: any }[]
    let selectClause = "*";
    if (operations && operations.length > 0) {
      const columns = await runQuery(`PRAGMA table_info(${sourceTable})`);
      selectClause = columns.map(col => {
        const op = operations.find((o: any) => o.column === col.name);
        if (op) {
          if (op.type === 'coalesce') return `COALESCE("${col.name}", '${op.value}') AS "${col.name}"`;
          if (op.type === 'cast') return `CAST("${col.name}" AS ${op.value}) AS "${col.name}"`;
          if (op.type === 'upper') return `UPPER("${col.name}") AS "${col.name}"`;
          if (op.type === 'lower') return `LOWER("${col.name}") AS "${col.name}"`;
        }
        return `"${col.name}"`;
      }).join(", ");
    }
    
    await runQuery(`CREATE TABLE ${targetTable} AS SELECT ${selectClause} FROM ${sourceTable}`);
    res.json({ tableName: targetTable });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/correlate", async (req, res) => {
  try {
    const { tableName } = req.body;
    const data = await runQuery(`SELECT * FROM ${tableName}`);
    
    // Simple Pearson correlation for numeric columns
    const numericCols = Object.keys(data[0]).filter(key => !isNaN(Number(data[0][key])));
    const matrix: any = {};
    
    for (const colA of numericCols) {
      matrix[colA] = {};
      for (const colB of numericCols) {
        const valsA = data.map(d => Number(d[colA]));
        const valsB = data.map(d => Number(d[colB]));
        
        // Pearson correlation calculation
        const n = valsA.length;
        const sumA = valsA.reduce((a, b) => a + b, 0);
        const sumB = valsB.reduce((a, b) => a + b, 0);
        const sumAB = valsA.reduce((acc, val, i) => acc + val * valsB[i], 0);
        const sumA2 = valsA.reduce((a, b) => a + b * b, 0);
        const sumB2 = valsB.reduce((a, b) => a + b * b, 0);
        
        const num = n * sumAB - sumA * sumB;
        const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
        
        matrix[colA][colB] = den === 0 ? 0 : num / den;
      }
    }
    
    res.json(matrix);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/collect/search", async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    // Mocking Google Search results for now - will be replaced by frontend Gemini call
    const results = [
      { title: `${query} Result 1`, link: "https://example.com/1", snippet: "Description for result 1" },
      { title: `${query} Result 2`, link: "https://example.com/2", snippet: "Description for result 2" },
      { title: `${query} Result 3`, link: "https://example.com/3", snippet: "Description for result 3" },
    ];
    
    const tableName = `search_${Date.now()}`;
    await runQuery(`CREATE TABLE ${tableName} (title TEXT, link TEXT, snippet TEXT)`);
    for (const r of results) {
      const title = r.title.replace(/'/g, "''");
      const link = r.link.replace(/'/g, "''");
      const snippet = r.snippet.replace(/'/g, "''");
      await runQuery(`INSERT INTO ${tableName} VALUES ('${title}', '${link}', '${snippet}')`);
    }
    
    res.json({ tableName, count: results.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/collect/results", async (req: Request, res: Response) => {
  try {
    const { results, type } = req.body;
    if (!results || !Array.isArray(results)) return res.status(400).json({ error: "Invalid results" });
    
    const tableName = `${type || 'data'}_${Date.now()}`;
    if (results.length === 0) {
      return res.json({ tableName, count: 0 });
    }

    const keys = Object.keys(results[0]);
    const safeColumns = keys.map(k => `"${k.replace(/"/g, '""')}"`);
    await runQuery(`CREATE TABLE ${tableName} (${safeColumns.map(c => `${c} TEXT`).join(", ")})`);
    
    const placeholders = keys.map(() => "?").join(", ");
    const stmt = conn.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
    for (const r of results) {
      const values = keys.map(k => String(r[k] || ''));
      stmt.run(...values);
    }
    stmt.finalize();
    
    res.json({ tableName, count: results.length });
  } catch (error) {
    console.error("[Results Import Error]", error);
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/collect/scrape", async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    console.log(`[Scraper] Fetching URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on non-2xx
    });
    
    console.log(`[Scraper] Status: ${response.status} for ${url}`);

    if (response.status >= 400) {
      return res.status(response.status).json({ 
        error: `Le site a répondu avec une erreur ${response.status}. Certains sites bloquent l'accès automatisé.` 
      });
    }

    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    res.json({ html: html.substring(0, 50000) });
  } catch (error: any) {
    console.error(`[Scraper] Error fetching ${req.body.url}:`, error.message);
    res.status(500).json({ 
      error: `Impossible de joindre le site : ${error.message}. Vérifiez l'URL ou réessayez plus tard.` 
    });
  }
});

app.post("/api/collect/pdf", upload.single("file"), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    console.log(`[PDF] Processing file: ${req.file.originalname}`);
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(dataBuffer);
    console.log(`[PDF] Extracted text length: ${data.text.length}`);
    res.json({ text: data.text });
  } catch (error: any) {
    console.error(`[PDF] Error:`, error.message);
    res.status(500).json({ error: `Erreur lors de la lecture du PDF : ${error.message}` });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.post("/api/collect/ocr", upload.single("file"), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    console.log(`[OCR] Processing file: ${req.file.originalname}`);
    const { data: { text } } = await Tesseract.recognize(req.file.path, 'fra');
    console.log(`[OCR] Extracted text length: ${text.length}`);
    res.json({ text });
  } catch (error: any) {
    console.error(`[OCR] Error:`, error.message);
    res.status(500).json({ error: `Erreur lors de l'OCR : ${error.message}` });
  } finally {
    if (req.file) fs.unlinkSync(req.file.path);
  }
});

app.post("/api/collect/sample", async (req, res) => {
  try {
    const tableName = `sample_${Date.now()}`;
    await runQuery(`CREATE TABLE ${tableName} (id INTEGER, name TEXT, age INTEGER, city TEXT, email TEXT, score FLOAT)`);
    const samples = [
      [1, 'Alice', 25, 'Paris', 'alice@example.com', 0.85],
      [2, 'Bob', 30, 'Lyon', 'bob@example.com', 0.92],
      [3, 'Charlie', 22, 'Marseille', 'charlie@example.com', 0.78],
      [4, 'David', 35, 'Bordeaux', 'david@example.com', 0.88],
      [5, 'Eve', 28, 'Lille', '', 0.95], // Missing email
      [6, 'Frank', 30, 'Lyon', 'frank@example.com', 0.92], // Duplicate Bob's age/city
      [7, 'Grace', 40, 'Nantes', 'grace@example.com', 0.81],
      [8, 'Heidi', 24, 'Strasbourg', 'heidi@example.com', 0.76],
      [9, 'Ivan', 31, 'Toulouse', 'ivan@example.com', 0.89],
      [10, 'Judy', 29, 'Nice', 'judy@example.com', 0.94],
    ];
    for (const s of samples) {
      const values = s.map(v => typeof v === 'string' ? `'${v}'` : v).join(", ");
      await runQuery(`INSERT INTO ${tableName} VALUES (${values})`);
    }
    res.json({ tableName, count: samples.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/projects/save", async (req, res) => {
  try {
    const { projects, library, tables, currentProject, activeStep } = req.body;
    const data = JSON.stringify({ projects, library, tables, currentProject, activeStep }, null, 2);
    fs.writeFileSync("projects_backup.json", data);
    res.json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/projects/load", async (req, res) => {
  try {
    if (fs.existsSync("projects_backup.json")) {
      const data = fs.readFileSync("projects_backup.json", "utf-8");
      res.json(JSON.parse(data));
    } else {
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
