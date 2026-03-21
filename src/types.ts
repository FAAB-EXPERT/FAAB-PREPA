export interface DataRow {
  [key: string]: any;
}

export interface AuditResult {
  totalCount: number;
  duplicateCount: number;
  columnAudit: {
    [column: string]: {
      nullCount: number;
    };
  };
}

export type AppStep = 'dossiers' | 'collect' | 'filter' | 'audit' | 'clean' | 'correlate' | 'report';

export interface TableInfo {
  tableName: string;
  step: AppStep;
  timestamp: number;
  projectId: string;
}
