import React, { useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, MessageCircle, Sparkles, Users } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import PageTitle from './PageTitle';
import { useAuth } from './AuthProvider';
import { crearPartido, supabase } from '../supabase';
import { buildMatchLocationFields } from '../utils/matchLocation';
import {
  parseWhatsAppMatchText,
  WHATSAPP_ALLOWED_FORMATS,
} from '../utils/whatsappMatchParser';

const MODALIDAD_CUPOS = {
  F5: 10,
  F6: 12,
  F7: 14,
  F