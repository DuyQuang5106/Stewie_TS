import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { readConfig } from './config.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool = new Pool({
    connectionString: readConfig().databaseUrl,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    query_timeout: 3000,
    statement_timeout: 3000,
    application_name: 'stiu-api-ts',
  });

  constructor() {
    this.pool.on('error', () =>
      this.logger.error('PostgreSQL pool connection failed'),
    );
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      this.logger.warn(
        'PostgreSQL readiness check failed; verify availability and credentials',
      );
      throw new Error('Database unavailable');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  async writeTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!readConfig().academicWriteApiEnabled)
      throw new Error('Academic writes are disabled');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async readSnapshot<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
