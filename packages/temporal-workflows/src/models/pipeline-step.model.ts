import mongoose, { Schema } from 'mongoose';

export interface PipelineStepInterface {
  stepKey: string;
  name: string;
  description: string;
  order: number;
  systemPrompt: string;
  userPromptTemplate: string;
  model: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  version: number;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PipelineStepSchema = new Schema<PipelineStepInterface>(
  {
    stepKey: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    order: {
      type: Number,
      required: true
    },
    systemPrompt: {
      type: String,
      required: true
    },
    userPromptTemplate: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true,
      default: 'gpt-4o-mini'
    },
    temperature: {
      type: Number,
      default: 0.1,
      min: 0,
      max: 2
    },
    maxTokens: {
      type: Number,
      default: 500
    },
    isActive: {
      type: Boolean,
      default: true
    },
    version: {
      type: Number,
      default: 1
    },
    updatedBy: {
      type: String
    }
  },
  {
    timestamps: true,
    collection: 'pipeline_steps'
  }
);

PipelineStepSchema.index({ order: 1, isActive: 1 });

export const PipelineStep = mongoose.model('PipelineStep', PipelineStepSchema);
