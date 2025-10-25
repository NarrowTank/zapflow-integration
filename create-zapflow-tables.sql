-- Criar apenas as tabelas do ZapFlow sem afetar as existentes

-- Tabela de sessões do ZapFlow
CREATE TABLE IF NOT EXISTS zapflow_sessions (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  last_message TEXT,
  current_step VARCHAR(50) DEFAULT 'welcome' NOT NULL,
  context JSONB,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  aluno_id INTEGER REFERENCES alunos(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Tabela de logs de mensagens do ZapFlow
CREATE TABLE IF NOT EXISTS zapflow_message_logs (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  direction VARCHAR(20) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  metadata JSONB,
  session_id INTEGER REFERENCES zapflow_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Tabela de integrações do ZapFlow
CREATE TABLE IF NOT EXISTS zapflow_integrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  config JSONB,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_zapflow_sessions_phone ON zapflow_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_zapflow_message_logs_phone ON zapflow_message_logs(phone);
CREATE INDEX IF NOT EXISTS idx_zapflow_message_logs_session_id ON zapflow_message_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_zapflow_message_logs_created_at ON zapflow_message_logs(created_at);

-- Comentários nas tabelas
COMMENT ON TABLE zapflow_sessions IS 'Sessões de conversação do ZapFlow Integration';
COMMENT ON TABLE zapflow_message_logs IS 'Logs de mensagens do ZapFlow Integration';
COMMENT ON TABLE zapflow_integrations IS 'Configurações de integrações do ZapFlow';

