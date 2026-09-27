import { Logger } from '@nestjs/common';
import { PostgresIoAdapter } from './postgres-io.adapter';

const createAdapter = jest.fn(() => 'adaptador-de-postgres');
jest.mock('@socket.io/postgres-adapter', () => ({ createAdapter: () => createAdapter() }));

/** Un servidor de socket.io, reducido a lo único que nos importa de él. */
const fakeServer = () => ({ adapter: jest.fn() });

class TestAdapter extends PostgresIoAdapter {
  public servidor = fakeServer();
  // El `super.createIOServer` real necesita un puerto y un servidor HTTP; acá
  // sólo interesa qué hace PostgresIoAdapter DESPUÉS de crearlo.
  protected buildServer() {
    return this.servidor as never;
  }
}

describe('PostgresIoAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('con un pool conectado, reparte los eventos entre instancias', () => {
    const adapter = new TestAdapter({} as never, { on: jest.fn() } as never);
    adapter.createIOServer(0);
    expect(adapter.servidor.adapter).toHaveBeenCalledWith('adaptador-de-postgres');
  });

  it('sin pool sigue andando en memoria: una instancia sola es peor que ninguna app', () => {
    const adapter = new TestAdapter({} as never, null);
    adapter.createIOServer(0);
    expect(adapter.servidor.adapter).not.toHaveBeenCalled();
  });

  it('si el adaptador explota al armarse, no se lleva puesto el arranque', () => {
    createAdapter.mockImplementationOnce(() => { throw new Error('no hay base'); });
    const adapter = new TestAdapter({} as never, { on: jest.fn() } as never);
    expect(() => adapter.createIOServer(0)).not.toThrow();
    expect(adapter.servidor.adapter).not.toHaveBeenCalled();
  });
});
