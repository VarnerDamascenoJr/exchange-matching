import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('should trim the username before validation', async () => {
    const dto = plainToInstance(LoginDto, {
      username: '  alice  ',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.username).toBe('alice');
  });

  it('should reject an empty username', async () => {
    const dto = plainToInstance(LoginDto, {
      username: '   ',
    });

    const errors = await validate(dto);

    expect(errors).not.toHaveLength(0);
  });
});
