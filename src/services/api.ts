import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

export const collectCsv = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/collect/csv', formData);
  return res.data;
};

export const collectExcel = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/collect/excel', formData);
  return res.data;
};

export const collectJson = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/collect/json', formData);
  return res.data;
};

export const getData = async (tableName: string, limit: number = 100) => {
  const res = await api.get(`/data/${tableName}?limit=${limit}`);
  return res.data;
};

export const filterData = async (sourceTable: string, filters: any[], limit?: number) => {
  const res = await api.post('/filter', { sourceTable, filters, limit });
  return res.data;
};

export const auditData = async (tableName: string) => {
  const res = await api.post('/audit', { tableName });
  return res.data;
};

export const cleanData = async (sourceTable: string, operations: any[]) => {
  const res = await api.post('/clean', { sourceTable, operations });
  return res.data;
};

export const correlateData = async (tableName: string) => {
  const res = await api.post('/correlate', { tableName });
  return res.data;
};

export const collectPdf = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/collect/pdf', formData);
  return res.data;
};

export const collectOcr = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/collect/ocr', formData);
  return res.data;
};

export const generateSample = async () => {
  const res = await api.post('/collect/sample');
  return res.data;
};

export const searchGoogle = async (query: string) => {
  const res = await api.post('/collect/search', { query });
  return res.data;
};

export const collectResults = async (results: any[], type: string) => {
  const res = await api.post('/collect/results', { results, type });
  return res.data;
};

export const scrapeUrl = async (url: string) => {
  const res = await api.post('/collect/scrape', { url });
  return res.data;
};

export const saveProjects = async (data: any) => {
  const res = await api.post('/projects/save', data);
  return res.data;
};

export const loadProjects = async () => {
  const res = await api.get('/projects/load');
  return res.data;
};
