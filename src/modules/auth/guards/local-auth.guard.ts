import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  canActivate(context: ExecutionContext) {
    // Add your custom authentication logic here
    // for example, call super.logIn(request) to establish a session.
    return super.canActivate(context);
  }

  handleRequest(err, user, info, context: ExecutionContext, status) {
    // You can throw an exception based on either "info" or "err" arguments
    const request = context.switchToHttp().getRequest();
    const { email, password, type } = request.body;

    if (err || !user) {
      if (!email) {
        throw new HttpException(
          { message: 'email not provided' },
          HttpStatus.OK,
        );
      } else if (!password) {
        throw new HttpException(
          { message: 'password not provided' },
          HttpStatus.OK,
        );
      } else {
        throw err || new UnauthorizedException();
      }
    }

    // ✅ NEW: Check if user is admin - if so, skip type validation
    if (user.type === 'ADMIN') {
      // Admin users don't need type field
      console.log('Admin login detected, skipping type validation');
    } else {
      // ✅ NEW: For non-admin users (DRIVER/GARAGE), require type field
      if (!type) {
        throw new HttpException(
          { message: 'type not provided for non-admin users' },
          HttpStatus.OK,
        );
      }

      // ✅ NEW: Validate type matches user type
      if (user.type !== type) {
        throw new HttpException(
          {
            message: 'Invalid user type',
            code: 'INVALID_USER_TYPE',
            expected: user.type,
            provided: type,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    // Add email verification check
    if (!user.email_verified_at) {
      throw new HttpException(
        {
          message: 'Please verify your email before logging in',
          code: 'EMAIL_NOT_VERIFIED',
          email: user.email,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    return user;
  }
}
